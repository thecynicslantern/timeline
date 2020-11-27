// Copyright thecynicslantern.net, 2020
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
    - eg: Timeline.tween(2000, v => myDiv.style.opacity = v);

- create a timeline

    let timeline = Timeline();
    - or timeline = new Timeline();

- add an action to occur at a specific time

    timeline.at(time, func, undo = null)

    - undo (if a function) will be called when the specified time is reached while seeking backwards
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

- read the timeline's internal time position

    timeline.position
	
    - read only

- set position without triggering any frames

    timeline.jump(time)



/** notes **\______________________________

- frame callbacks are called in expected order, including when seeking backwards
- tweens are applied in added order regardless of seek direction


*/ "use strict";

const sortFnInc = (a, b) => a === b ? 0 : (a < b ? 1 : -1);
const sortFnDec = (a, b) => a === b ? 0 : (a > b ? 1 : -1);
const callFunc = pair => pair[0]();
const callUndo = pair => pair[1] && (pair[1] === true) ? pair[0]() : pair[1]();

function Timeline() {
	if (!this) return new Timeline();
	let position = 0;
	const frames = {};
	const tweens = [];

	const applyTweens = to => {
		const from = position;
		if (to == from) return;
		tweens.forEach(entry => {
			const [startTime, endTime, apply, fromValue, toValue, easer] = entry;

			if (to > from && Math.max(startTime, from) > Math.min(endTime, to)) return;
			if (to < from && Math.max(startTime, to) > Math.min(endTime, from)) return;

			let progress;
			if (to <= startTime) {
				progress = 0;
			} else if (to >= endTime) {
				progress = 1;
			} else {
				const range = endTime - startTime;
				const pos = to - startTime;
				progress = pos / range;
			}
			if (easer) progress = easer(progress);
			const range = toValue - fromValue;
			progress = fromValue + progress * range;
			apply(progress);
		});
	};

	let seeking = false; // disallow seek() during seek()
	const seek = n => {
		if (seeking) throw new Error("timeline.seek() unavailable during frame callback");
		if (n == position) return;
		seeking = true;
		const reversed = n < position;
		const filterFn = reversed
			? k => (k < position) && (k >= n)
			: k => (k >= position) && (k < n);
		const timestamps = Object.keys(frames)
			.map(n => Number(n))
			.filter(filterFn)
			.sort(reversed ? sortFnDec : sortFnInc);
		const eachCb = reversed ? callUndo : callFunc;
		applyTweens(n);
		timestamps.forEach(k => {
			position = Number(k);
			let funcs = frames[k];
			if (reversed) funcs = funcs.reverse();
			funcs.forEach(eachCb);
		});
		position = n;
		seeking = false;
	};

	const api = {
		at: (time, func, undo = null) => {
			if (frames[time] === undefined) frames[time] = [];
			frames[time].push([func, undo]);
		},
		jump: n => {
			if (seeking) throw new Error("timeline.jump() unavailable during frame callback");
			position = n;
		},
		tick: (n = 1) => seek(position + n),
		seek,
		tween: (startTime, duration, func, from = 0, to = 1, easer = null) => {
			tweens.push([startTime, startTime + duration, func, from, to, easer]);
			if (startTime <= position && startTime + duration > position) applyTweens(position);
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
};

Timeline.tween = (duration, func, from = 0, to = 1, easer, fps = 60) => new Promise(resolve => {
	const tl = new Timeline();
	const t = Math.round(1000 / fps);
	tl.tween(0, duration, func, from, to, easer);
	const interval = setInterval(() => tl.tick(t), t);

	setTimeout(() => {
		tl.seek(duration);
		clearInterval(interval);
		resolve();
	}, duration);
});


module.exports = Timeline;