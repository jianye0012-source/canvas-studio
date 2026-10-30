// The arms' paths over a keyed span (C14, lane K8). What the arm does on a frame the keys lead
// (the holding elbow's swivel, compiler/arm-orient.js; the second hand's roll about the object,
// second-hand.js) is read as a cost per frame on the pose that frame starts from, and the path
// minimises, over all those frames at once, the cost of each frame plus SMOOTH times the squared
// acceleration of the point that choice moves (the elbow; the free end of the second hand): where
// the cost barely cares the arm glides, where it does the arm goes where the wrist needs it. The
// best choice alone can move 20 deg from one frame to the next while a bat whips through the
// zone, and an arm that followed it would jerk (QA POP). Solved by NEWTON Gauss-Newton steps from
// each frame's soft minimum, each a banded (5-diagonal) linear solve. Every frame reads the same
// plan, so a frame still solves on its own (a windowed compile, a frame solved on demand) and the
// same spec gives the same take.
// The holding elbow's path never jumps (lane Q1, steadyPath). Where the cheap poles of two frames
// in a row lie on either side of a ridge, smoothPath from each frame's soft minimum stays in a
// local optimum that jumps across it (session 4db5d447, the follow-through: the elbow could hold
// the bat down-forward to f43 and up-forward from f44, and the planned elbow went 22 cm in one
// frame, QA POP and FLIP 78 deg). A path that jumps (jumpsIn) is solved again from the cheapest
// path that never turns more than JUMP a frame (continuousPath, dynamic programming over the
// poles), and if the cost pulls that back into a jump, with the smoothing BOOST times stronger
// around it: the elbow goes over the ridge in a few frames (QA-17 run: at most 10 cm a frame,
// the plane 26 deg a frame) and pays its strain there. A path that does not jump, and one these
// do not free of its jump (the keys jerk the hand there), is the plan as before, bit for bit.
import { holdLandscape } from "./compiler/hold.js";
import { add, sub, scale, dot, angle, len } from "./compiler/math.js";

const SMOOTH = 1000, NEWTON = 4, STEP = 0.03, MAX_STEP = 0.6, MIN_CURVE = 0.05, SIGMA = 2;
// A jump: the pole turns more than JUMP deg in a frame while the elbow moves more than SPIKE times
// as far as in the frames around and more than FLOOR m (QA POP's floor, accLimb). The continuous
// path prices each turn TURN per squared radian and OVER_TURN past JUMP; BOOST, AROUND as above.
const JUMP = 45, SPIKE = 2, FLOOR = 0.05, TURN = 10, OVER_TURN = 400, BOOST = 16, AROUND = 4;
/** The poles continuousPath reads (radians from the landscape's th 0), 5 deg apart. */
const POLE_GRID = Array.from({ length: 72 }, (_, i) => (2 * Math.PI * i) / 72 - Math.PI);

/** Solve the symmetric 5-diagonal system A x = b; A[i][k] is the entry (i, i + k - 2). */
function solveBand(A, b) {
	const n = b.length, x = Array.from(b);
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j <= Math.min(i + 2, n - 1); j++) {
			const m = A[j][i - j + 2] / A[i][2];
			for (let k = i; k <= Math.min(i + 2, n - 1); k++) A[j][k - j + 2] -= m * A[i][k - i + 2];
			x[j] -= m * x[i];
		}
	}
	for (let i = n - 1; i >= 0; i--) {
		for (let k = i + 1; k <= Math.min(i + 2, n - 1); k++) x[i] -= A[i][k - i + 2] * x[k];
		x[i] /= A[i][2];
	}
	return x;
}

/**
 * The angle per frame (radians, frames in a row) that minimises sum cost(i, x_i) + SMOOTH *
 * sum weight_r |P(r) - 2 P(r+1) + P(r+2)|^2 with P(i) = point(i, x_i) (metres), from x0 (each
 * frame's own best, unwrapped here so neighbours differ by less than half a turn); weight 1 when
 * not given.
 */
export function smoothPath(cost, point, x0, weight = null) {
	const n = x0.length, x = x0.slice();
	for (let i = 1; i < n; i++) x[i] = x[i - 1] + Math.atan2(Math.sin(x[i] - x[i - 1]), Math.cos(x[i] - x[i - 1]));
	for (let it = 0; it < NEWTON && n > 2; it++) {
		const A = x.map(() => new Float64Array(5)), b = new Float64Array(n);
		x.forEach((t, i) => {
			const c0 = cost(i, t), cp = cost(i, t + STEP), cm = cost(i, t - STEP);
			A[i][2] = Math.max(MIN_CURVE, (cp + cm - 2 * c0) / (STEP * STEP));
			b[i] = -(cp - cm) / (2 * STEP);
		});
		// linearised: the point moves along tan = dP/dx
		const P = x.map((t, i) => point(i, t)), tan = x.map((t, i) => scale(sub(point(i, t + STEP), point(i, t - STEP)), 1 / (2 * STEP)));
		for (let r = 0; r + 2 < n; r++) {
			const c = [1, -2, 1], acc = add(sub(P[r], scale(P[r + 1], 2)), P[r + 2]), k = weight ? 2 * SMOOTH * weight[r] : 2 * SMOOTH;
			for (let p = 0; p < 3; p++) {
				b[r + p] -= k * c[p] * dot(acc, tan[r + p]);
				for (let q = 0; q < 3; q++) A[r + p][q - p + 2] += k * c[p] * c[q] * dot(tan[r + p], tan[r + q]);
			}
		}
		const step = solveBand(A, b);
		x.forEach((t, i) => { x[i] = t + Math.max(-MAX_STEP, Math.min(MAX_STEP, step[i])); });
	}
	return x;
}

/**
 * The frames i where the path x jumps from frame i to i + 1: dir (a unit vector, the elbow's pole)
 * turns more than JUMP degrees and the point (the elbow) moves more than SPIKE times as far as in
 * the frame before or after, and more than FLOOR metres. A pole that turns while the arm is
 * straight barely moves the elbow, and a swing moves it fast for several frames: neither is a jump.
 */
function jumpsIn(x, dir, point) {
	const P = x.map((t, i) => point(i, t)), step = i => (i >= 0 && i + 1 < P.length ? len(sub(P[i + 1], P[i])) : 0);
	return x.slice(1).map((t, i) => i).filter(i => step(i) > FLOOR && step(i) > SPIKE * Math.max(step(i - 1), step(i + 1)) && angle(dir(i, x[i]), dir(i + 1, x[i + 1])) > JUMP);
}

/**
 * The path over the candidate angles `grid` that minimises sum cost(i, x_i) + TURN * sum a_i^2
 * plus OVER_TURN * (a_i - JUMP)^2 past JUMP, a_i the turn (radians) of dir from frame i to i + 1
 * (dynamic programming): the cheapest way through that never jumps, whichever valley it starts in.
 */
function continuousPath(cost, dir, n, grid) {
	const K = grid.length, lim = JUMP * Math.PI / 180, C = [], U = [];
	for (let i = 0; i < n; i++) { C.push(grid.map(t => cost(i, t))); U.push(grid.map(t => dir(i, t))); }
	let total = C[0].slice();
	const back = [];
	for (let i = 1; i < n; i++) {
		const next = new Array(K), from = new Int32Array(K);
		for (let k = 0; k < K; k++) {
			let best = Infinity;
			for (let j = 0; j < K; j++) {
				const a = Math.acos(Math.max(-1, Math.min(1, dot(U[i - 1][j], U[i][k])))), t = total[j] + TURN * a * a + (a > lim ? OVER_TURN * (a - lim) ** 2 : 0);
				if (t < best) { best = t; from[k] = j; }
			}
			next[k] = best + C[i][k];
		}
		back.push(from);
		total = next;
	}
	const pick = new Array(n);
	pick[n - 1] = total.indexOf(Math.min(...total));
	for (let i = n - 1; i > 0; i--) pick[i - 1] = back[i - 1][pick[i]];
	return pick.map(k => grid[k]);
}

/**
 * smoothPath that never jumps (jumpsIn): dir(i, x) is the world direction choice x gives frame i
 * (the elbow's pole), grid the candidate angles. When the path smoothPath finds from x0 jumps, it
 * starts again from the continuous path (continuousPath); if the cost pulls that back into a jump,
 * the acceleration terms within AROUND frames of it weigh BOOST times more. A path that does not
 * jump is smoothPath's, bit for bit, and so is one these do not free of jumps (the keys themselves
 * jerk the hand there).
 */
export function steadyPath(cost, point, x0, dir, grid = POLE_GRID) {
	const x = smoothPath(cost, point, x0);
	if (!jumpsIn(x, dir, point).length) return x;
	const y0 = continuousPath(cost, dir, x.length, grid), y = smoothPath(cost, point, y0), jumps = jumpsIn(y, dir, point);
	if (!jumps.length) return y;
	const weight = new Float64Array(Math.max(0, y.length - 2)).map((_, r) => (jumps.some(j => j >= r - AROUND && j <= r + 1 + AROUND) ? BOOST : 1));
	const z = smoothPath(cost, point, y0, weight);
	return jumpsIn(z, dir, point).length ? x : z;
}

/** Values over frames in a row, smoothed by a Gaussian of SIGMA frames (the weights renormalised at the ends). */
export function smoothed(v) {
	return v.map((_, i) => {
		let sum = 0, wsum = 0;
		for (let j = Math.max(0, i - 3 * SIGMA); j <= Math.min(v.length - 1, i + 3 * SIGMA); j++) { const g = Math.exp(-((j - i) ** 2) / (2 * SIGMA * SIGMA)); sum += g * v[j]; wsum += g; }
		return sum / wsum;
	});
}

/**
 * The holding elbow's planned pole per frame, Map f -> world direction, over `frames` (ascending
 * and contiguous, the frames the keys lead). frameAt(f) -> { s, held }: the plain pose of frame f
 * and what the hand holds there (object-keys.js lead).
 */
export function polePlan(sk, side, frames, frameAt) {
	const lands = frames.map(f => { const { s, held } = frameAt(f); return holdLandscape(sk, s, side, held); });
	const th = steadyPath((i, t) => lands[i].at(t).cost, (i, t) => lands[i].at(t).elbow, lands.map(l => l.softmin()), (i, t) => lands[i].at(t).pv);
	return new Map(frames.map((f, i) => [f, lands[i].at(th[i]).pv]));
}
