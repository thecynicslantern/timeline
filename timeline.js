// Copyright thecynicslantern.net, 2020-2021
// License: https://github.com/thecynicslantern/timeline/blob/main/LICENSE
// Homepage: https://www.thecynicslantern.net/timeline/

/** quick guide **\______________________________

const Timeline = require("timeline.js");

- immediately start an animation:

    Timeline.tween(duration, func, from = 0, to = 1, easer = null, fps = 60)

    - per frame, func will be passed a value between from and to according to progression
    - easer, optional, is a function of (progression) => number, passed a number between 0 and 1
    - duration is in milliseconds
    - returns a Promise, resolved when the tween ends
    - eg: Timeline.tween(2000, v => myDiv.style.opacity = v).then(() => body.removeChild(myDiv));

- create a timeline

    let timeline = Timeline(autoplay = false);
     - or timeline = new Timeline(autoplay = false);
 
     - autoplay option uses play(), below

- add an action to occur at a specific time

    timeline.at(time, func, undo = null)

    - undo (if a function) will be called when the specified time is passed while seeking backwards
    - if undo is `true`, func will be called in this case
    - if undo is `null` (default), this event will be ignored while seeking backwards
    - eg: timeline.at(5000, () => myDiv.classList.add("visible"), () => myDiv.classList.remove("visible"));

- apply a function per frame within a time range

    timeline.tween(startTime, duration, func, from = 0, to = 1, easer = null)

    - func will be passed values between from and to according to progression
    - duration is any unit as consistent with seek() and tick()
    - eg: timeline.tween(5000, 1000, v => myDiv.style.opacity = v);

- seek forward n time, triggering events between

    timeline.tick(n = 1)

    - n may be negative
    - eg: setInterval(() => timeline.tick(16), 16);

- seek to a position, triggering events between

    timeline.seek(n)

    - eg: window.onscroll = () => timeline.seek(window.scrollY);

- add an action to occur at a relative time

    timeline.in(timeDelta, func, undo = null)

    - equivalent to timeline.at(timeline.position + timeDelta, func, undo)
    - if this is called within a timeline event, the resulting event will
        be correctly placed relative to the first regardless of FPS.

- make it go

	 timeline.play(fps = 60)
	 
	 - sets an interval to tick the timeline in real time
	 - fps is subject to background tab limitations as applied by browsers

- make it repeat

    timeline.loopAt(n, rewind = true) [ experimental and incomplete ]

    - position will wrap back to 0 when it reaches n
    - if rewind is true, events and tweens will be applied in the reversal
 
- change speed

     timeline.timescale

    - affects timelines that run via timeline.play()
    - does not affect tick() or seek()
    - eg: tl.timescale = .25; // run at quarter speed

- read the timeline's internal time position

    timeline.position

    - read only

- set raw position without triggering any events or tweens

    timeline.jump(time)


/** notes **\______________________________

- event callbacks are called in expected order, reversed when seeking backwards
- undocumented functionality may change


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

	const setDeferredPurge = () => {
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

	const sort = reverse => {
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

	const applyTweens = to => {
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
	const seek = n => {
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
				? k => (k < position) && (k >= n)
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
	const createThenApi = startOffset => ({
		thenTween: (delay, duration, tweenFunc = null, from = 0, to = 1, easer = null) => {
			return tween(startOffset + delay, duration, tweenFunc, from, to, easer);
		},
		thenIn: (delay, func, undo = null) => {
			at(startOffset + delay, func, undo);
		}
	});

	const tween = (startTime, duration, func, from = 0, to = 1, easer = null) => {
		if (!(typeof func == "function")) throw new Error("expected function, got " + typeof func);
		const endTime = startTime + duration;
		tweens.push([startTime, endTime, func, from, to, easer]);
		if (startTime <= position && endTime >= position) applyTweens(position);
		currentTweenOrder = CURRENT_ORDER_NONE; // force tween sort on next frame

		return createThenApi(startTime + duration);
	};

	const at = (time, func, undo = null) => {
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
		jump: n => {
			if (seeking) throw new Error("timeline.jump() unavailable during event callback");
			position = n;
		},
		tick: (n = 1) => seek(position + n),
		seek,
		tween,
		loopAt: (time, rewind = true) => {
			loopRewind = rewind;
			loopAt = time;
		},
		play: (fps = 60) => {
			if (playInterval !== null) clearInterval(playInterval);
			lastPlayTime = (new Date).getTime();
			playInterval = setInterval(() => {
				const t = (new Date).getTime();
				api.tick((t - lastPlayTime) * timescale);
				lastPlayTime = t;
			}, Math.round(1000 / fps));
		},
		pause: () => {
			if (playInterval !== null) clearInterval(playInterval);
			playInterval = null;
		},
		// set to avoid wasting memory on redundant historic events
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