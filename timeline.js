// Copyright thecynicslantern.net, 2020-2021
// License: https://github.com/thecynicslantern/timeline/blob/main/LICENSE
// Homepage: https://www.thecynicslantern.net/timeline/

/*
*/ "use strict";

const sortFnInc = (a, b) => a === b ? 0 : (a < b ? 1 : -1);
const sortFnDec = (a, b) => a === b ? 0 : (a > b ? 1 : -1);
const sortTweenFnForward = (a, b) => a[1] === b[1] ? 0 : (a[1] > b[1] ? 1 : -1);
const sortTweenFnBackward = (a, b) => a[0] === b[0] ? 0 : (a[0] < b[0] ? 1 : -1);

const callFunc = pair => pair[0]();
const callUndo = pair => pair[1] && ((pair[1] === true) ? pair[0]() : pair[1]());

const CURRENT_ORDER_NONE = 0,
	CURRENT_ORDER_FORWARD = 1,
	CURRENT_ORDER_BACKWARD = 2;

function Timeline(autoplay = false) {
	if (!this) return new Timeline(autoplay);
	let position = 0;
	const events = {};
	let tweens = [];
	let loopAt = null, loopRewind;
	let oneWay = false;
	let currentTweenOrder = CURRENT_ORDER_NONE;
	let currentEventOrder = CURRENT_ORDER_NONE;
	let sortedEvents;

	let purgeTimer = null;
	let purgeTweens = false;
	let purgeEvents = false;

	function setDeferredPurge(){
		if (purgeTimer === null) {
			purgeTimer = setTimeout(() => {
				purgeTimer = null;
				if (purgeTweens) tweens = tweens.filter(tweenData => tweenData[1] >= position);
				if (purgeEvents) Object.keys(events).forEach(k => {
					if (k < n) delete events[k];
				});
				purgeTweens = false;
			}, 0);
		}
	};

	function sort(reverse){
		// we don't want to sort every frame so keep track of how each list is currently sorted
		const sortOrder = reverse ? CURRENT_ORDER_BACKWARD : CURRENT_ORDER_FORWARD;
		if (currentTweenOrder !== sortOrder) {
			// furthest tween last
			tweens = tweens.sort(reverse ? sortTweenFnBackward : sortTweenFnForward);
			currentTweenOrder = sortOrder;
		}
		if (currentEventOrder !== sortOrder) {
			sortedEvents = Object.keys(events)
				.map(n => Number(n))
				.sort(reverse ? sortFnDec : sortFnInc);
			currentEventOrder = sortOrder;
		}
	};

	function applyTweens(to){
		const from = position;
		tweens.forEach(entry => {
			let [startTime, endTime, apply, fromValue, toValue, easer] = entry;
			if (typeof fromValue == "function") fromValue = fromValue();
			if (typeof toValue == "function") toValue = toValue();

			// cancel tweens where range doesn't overlap with from..to
			if (to >= from && Math.max(startTime, from) > Math.min(endTime, to)) return;
			if (to < from && Math.max(startTime, to) > Math.min(endTime, from)) return;

			let progress;
			if (to <= startTime) {
				progress = 0;
			} else if (to > endTime) {
				progress = 1;
				if (oneWay) {
					purgeTweens = true;
					setDeferredPurge();
				}
			} else {
				const pos = to - startTime;
				progress = pos / (endTime - startTime);
			}
			if (easer) progress = easer(progress);
			const range = toValue - fromValue;
			let value = fromValue + progress * range;
			apply(value);
		});
	};

	let seeking = false; // disallow seek() during seek()
	function seek(n){
		n = Number(n);
		if (seeking) throw new Error("timeline.seek() unavailable during event callback");
		if (n == position) return;
		if (oneWay && n < position) throw new Error("wrong way down a one-way timeline"); // yir faither wid be proud
		while (loopAt !== null && loopAt > 0 && n > loopAt) {
			// make sure each passed-over iteration is processed
			seek(loopAt);
			n -= loopAt;
			if (loopRewind) {
				seek(0);
			} else {
				position = 0;
			}
		}
		if (n === loopAt) n = 0;
		sort(n < position);

		seeking = true;
		try {
			const from = position;
			const reversing = n < position;
			const filterFn = reversing
				? k => (k <= position) && (k > n)
				: k => (k > position) && (k <= n);
			const timestamps = sortedEvents.filter(filterFn);
			timestamps.forEach(k => {
				// timeline.position reflects the event's exact position during its handler
				position = Number(k);
				let funcs = events[k];
				if (reversing) funcs = funcs.reverse();
				funcs.forEach(reversing ? callUndo : callFunc);
			});

			position = from;
			applyTweens(n);

			if (oneWay && timestamps.length) {
				purgeEvents = true;
				setDeferredPurge();
			}
			position = n;
		} finally {
			seeking = false;
		}
	};

	// creates the interface returned by tl.tween() and tl.at()
	function createThenApi(startOffset){
		return {
			thenTween: (delay, duration, tweenFunc = null, from = 0, to = 1, easer = null) => {
				return tween(startOffset + delay, duration, tweenFunc, from, to, easer);;
			},
			thenIn: (delay, func, undo = null) => {
				at(startOffset + delay, func, undo);
			}
		}
	};
    
    function getLastFramePosition(){
        let pos = 0;
        tweens.forEach(tween => {
            if(tween[1] > pos) pos = tween[1]; // [1] being endTime
        });
		// 'max' that against event times
		pos = Math.max(...[pos, ...Object.keys(events)]);
        return pos;
    };


	function tween(startTime, duration, func, from = 0, to = 1, easer = null){
		if (!(typeof func == "function")) throw new Error("expected function, got " + typeof func);
		const endTime = startTime + duration;
		tweens.push([startTime, endTime, func, from, to, easer]);
		if (startTime <= position && endTime >= position) applyTweens(position);
		currentTweenOrder = CURRENT_ORDER_NONE; // force tween sort on next frame

		return createThenApi(startTime + duration);
	};

	function at(time, func, undo = null){
		if (events[time] === undefined) events[time] = [];
		events[time].push([func, undo]);
		if (position == time) func();
		currentEventOrder = CURRENT_ORDER_NONE; // force event sort on next frame
		return createThenApi(time);
	};

	let lastPlayTime;
	let playInterval = null;
	let timescale = 1;

	const api = {
		at,
		in: (timeDelta, func, undo = null) => at(timeDelta + position, func, undo),
		jump(n){
			if (seeking) throw new Error("timeline.jump() unavailable during event callback");
			position = n;
		},
		tick(n = 1){ seek(position + n) },
		seek,
		tween,
		loopAt(time, rewind = true){
			loopRewind = rewind;
			loopAt = time;
		},
		play(fps = 60){
			if (playInterval !== null) clearInterval(playInterval);
			lastPlayTime = (new Date).getTime();
			playInterval = setInterval(() => {
				const t = (new Date).getTime();
				api.tick((t - lastPlayTime) * timescale);
				lastPlayTime = t;
			}, Math.round(1000 / fps));
		},
		pause(){
			if (playInterval !== null) clearInterval(playInterval);
			playInterval = null;
		},
		// set to avoid wasting memory on redundant historic events (for long-running, hot-modified timelines)
		oneWay: {
			get: () => oneWay,
			set: v => {
				oneWay = v;
				if (oneWay) setDeferredPurge();
			},
			enumerable: true
		},
		timescale: {
			get: () => timescale,
			set: v => {
				if (isNaN(v)) throw new Error("timescale may not be NaN");
				timescale = v;
			},
			enumerable: true
		},
		position: {
			get: () => position,
			enumerable: true
		},
		end: {
			get: () => getLastFramePosition(),
			enumerable: true
		}
	};
	const propertyDefs = {};
	Object.keys(api).forEach(k => {
		propertyDefs[k] = typeof api[k] == "function" ? { value: api[k], enumerable: true } : api[k];
	});
	Object.defineProperties(this, propertyDefs);

	if (autoplay) this.play();
};

Timeline.tween = (duration, func, from = 0, to = 1, easer, fps = 60) => new Promise(resolve => {
	const tl = new Timeline();
	tl.tween(0, duration, func, from, to, easer);
	tl.play(fps);
	tl.at(duration, () => {
		tl.pause();
		resolve();
	});
});

module.exports = Timeline;
