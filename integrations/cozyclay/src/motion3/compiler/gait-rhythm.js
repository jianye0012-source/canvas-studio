// The walk's rhythm (walk.js): when each step lifts off, how long the foot is in the air, how far
// it goes, how high it lifts and how much the arms swing. A person does not give every step the
// same time: the first steps build up, the last one slows into the stop, one side is a little
// quicker than the other, no two steps are alike, and a turn takes slower, shorter steps.
// Deterministic (a hash of the walk's own parameters seeds the step-to-step part) and zero-sum:
// the lift-offs are moved inside the walk's span (the walk still ends 16 + steps * period + 18
// frames after f0) and the middle strides keep their sum (the walk ends where it did). The first
// stride stays firstStep and the last step still brings the feet together.
// A person's strides also differ in length from one another as wholes (both steps a little longer or shorter),
// which the step-to-step terms alone do not show: their left/right part cancels over a stride. LENGTH.stride gives
// each middle stride its own length. (A stride time term is left out: any more time variation lowers the hips'
// rise and fall that walk-pelvis.js fits under the legs below a person's ~5 cm.)
// vary scales every term: 0 is the metronome (every step period frames apart, swing frames in the
// air, step metres long), 1 the default, 2 twice as uneven.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** text -> a generator of numbers in [-1, 1) (FNV-1a hash, then mulberry32). */
function noiseOf(text) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	let a = h >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), a | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
	};
}

// Sizes at vary 1, as fractions of the step's time or length.
const TIME = { noise: 0.02, side: 0.03, first: 0.22, second: 0.08, last: 0.22, beforeLast: 0.08, turn: 0 };
const LENGTH = { noise: 0.025, side: 0.012, stride: 0.035, second: 0.05, beforeLast: 0.06, turn: 0.06 };
const LIFT = { noise: 0.1, first: 0.1, last: 0.25 }, ARM = 0.1;
const CLOSE = 3; // frames the closing step may swing longer than swing
const TURN_FULL = 60; // degrees turned in one step at which a step is as slow and short as a turn makes it

/**
 * walkRhythm(W, { s0, turn, seed }) -> per step i (0-based, W.steps of them):
 *   lift[i]   frames after f0 + 16 at which the foot lifts off (lift[0] = 0)
 *   air[i]    frames that foot is in the air
 *   inc[i]    metres it advances along the path (inc[0] = firstStep, the last one 0)
 *   height[i] its lift, m;  arm[i] a factor on the arm swing it lands with
 * W: the walk's fields with defaults; s0 the path position the first step starts from; turn(sa, sb)
 * the degrees the heading turns between two path positions; seed a text naming this walk.
 */
export function walkRhythm(W, { s0, turn, seed }) {
	const n = W.steps, v = clamp(W.vary ?? 1, 0, 2), next = noiseOf(seed);
	const rows = Array.from({ length: n }, () => ({ time: next(), length: next(), lift: next(), arm: next() }));
	const quick = next() < 0 ? 1 : -1, side = i => (i % 2 === 0 ? quick : -quick);
	// one draw per stride (steps 1-2, 3-4, ...), after the step draws so those stay as they were
	const strides = Array.from({ length: Math.ceil(n / 2) }, () => next()), strideOf = i => strides[Math.floor((i - 1) / 2)];
	const inc0 = Array.from({ length: n }, (_, i) => (i === n - 1 ? 0 : i === 0 ? W.firstStep : W.step));
	let s = s0;
	const turned = inc0.map(d => { const deg = Math.abs(turn(s, s + d)); s += d; return Math.min(1, deg / TURN_FULL); });
	const long = n >= 4;
	// time: a share of the walk's steps * period frames per step, the shares summing to steps
	const share = rows.map((r, i) => {
		if (n < 2) return 1;
		// the first and the last step vary half as much: their build-up and slow-down should show
		const ends = i === 0 || i === n - 1 ? 0.5 : 1;
		let x = ends * (TIME.noise * r.time + TIME.side * side(i)) + TIME.turn * turned[i];
		if (i === 0) x += TIME.first * (1 - turned[0]);
		if (i === 1 && long) x += TIME.second;
		if (i === n - 1) x += TIME.last;
		if (i === n - 2 && long) x += TIME.beforeLast;
		return 1 + v * x;
	});
	const total = share.reduce((a, b) => a + b, 0), span = n * W.period;
	const lift = [];
	for (let i = 0, t = 0; i < n; i++) { lift.push(Math.round(t)); t += (span * share[i]) / total; }
	// air: a long step swings slower, keeping the double support the walk gives every step (period -
	// swing), so the trailing foot leaves the ground no further behind the hips than in an even walk (its
	// knee would snap straight at toe-off); a short step keeps its swing and shortens the double
	// support instead, the trailing heel rising before the other foot lands. The closing step swings at
	// most CLOSE frames longer: the hips go ahead over the other foot while it swings, and a slower
	// trailing foot falls out of the leg's reach; the time left over is standing still
	const support = W.period - W.swing;
	const air = lift.map((t, i) => {
		if (v === 0) return W.swing;
		const gap = (i < n - 1 ? lift[i + 1] : span) - t;
		return Math.min(gap - 2, Math.max(W.swing, gap - support), i === n - 1 ? W.swing + CLOSE : Infinity);
	});
	// length: the middle strides (not the first, not the closing one) keep their sum
	const mid = inc0.map((_, i) => i > 0 && i < n - 1);
	const g = rows.map((r, i) => {
		if (!mid[i]) return 1;
		let x = LENGTH.noise * (0.7 * r.length + 0.3 * r.time) + LENGTH.side * side(i) + LENGTH.stride * strideOf(i) - LENGTH.turn * turned[i];
		if (i === 1 && long) x -= LENGTH.second;
		if (i === n - 2 && long) x -= LENGTH.beforeLast;
		return 1 + v * x;
	});
	const count = mid.filter(Boolean).length, sum = g.reduce((a, b, i) => a + (mid[i] ? b : 0), 0);
	const inc = inc0.map((d, i) => (mid[i] && v > 0 ? (d * g[i] * count) / sum : d));
	const height = rows.map((r, i) => W.lift * (1 + v * (LIFT.noise * r.lift - (i === 0 ? LIFT.first : 0) - (i === n - 1 && n > 1 ? LIFT.last : 0))));
	const arm = rows.map(r => 1 + v * ARM * r.arm);
	return { lift, air, inc, height, arm };
}
