// How a falling object (C17, free-motion.js) comes to rest. It falls with its centre on a parabola, turning at the spin it
// was let go with, and lands on its lowest point. Then it rolls about what touches the support. Landing on an edge or a
// corner it rocks back onto the face nearest down, or falls over onto the face it leans to when it leans past that edge.
// Then it goes over an edge onto a lower face while the landing has the energy (a share TIP of the drop; only one that hit
// tilted or spinning, since a flat landing has nothing to tip it), or at once from a precarious face (one it can tilt less
// than PRECARIOUS before its centre passes the edge). So a phone on its edge falls flat, a tilted box comes down on a face,
// a can let go at a slant lies down, and a can or cup dropped upright stays upright. It only rolls onto a face that lowers
// its centre by at least LOWER of its height, so a near cube stays the way it lands. The shape is the box around the
// object's parts in its own frame, and its centre is the parts' volume-weighted centre. Every step is a rotation about a
// pivot on the support, paced by gravity: closed form and deterministic.
import { add, sub, scale, dot, cross, len, norm, mul, apply, axisRot, clamp } from "./compiler/math.js";
import { G } from "./free-motion.js";
import { flightTime } from "./flight.js";

/** The share of the drop height a landing spends tipping the object over an edge. */
export const TIP = 0.3;
const LOWER = 0.2, FLAT = 0.5, PRECARIOUS = 15, MIN_SPIN = 1, MAX_SPIN = 6 * Math.PI, MAX_STEPS = 3;
const DOWN = [0, -1, 0];
const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const deg = r => (r * 180) / Math.PI;

/** The shape of part boxes { pos, R, half } given in the root frame: { com, lo, hi } (box around the corners); null without volume. */
export function shapeOf(boxes) {
	const solid = boxes.filter(b => b.half[0] * b.half[1] * b.half[2] > 1e-12);
	if (!solid.length) return null;
	let vol = 0, c = [0, 0, 0];
	const corners = [];
	for (const b of solid) {
		const v = b.half[0] * b.half[1] * b.half[2];
		vol += v;
		c = add(c, scale(add(b.pos, apply(b.R, [0, b.half[1], 0])), v));
		for (const x of [-1, 1]) for (const y of [0, 2]) for (const z of [-1, 1]) corners.push(add(b.pos, apply(b.R, [x * b.half[0], y * b.half[1], z * b.half[2]])));
	}
	return { com: scale(c, 1 / vol), lo: [0, 1, 2].map(i => Math.min(...corners.map(p => p[i]))), hi: [0, 1, 2].map(i => Math.max(...corners.map(p => p[i]))) };
}

const boxCorners = s => [0, 1, 2, 3, 4, 5, 6, 7].map(i => [i & 1 ? s.hi[0] : s.lo[0], i & 2 ? s.hi[1] : s.lo[1], i & 4 ? s.hi[2] : s.lo[2]]);
const world = (pose, p) => add(pose.pos, apply(pose.R, p));
const lowest = (s, pose) => Math.min(...boxCorners(s).map(p => world(pose, p)[1]));
/** The pose moved up or down so its lowest corner sits on the support top. */
const snap = (s, pose, top) => ({ pos: [pose.pos[0], pose.pos[1] + top - lowest(s, pose), pose.pos[2]], R: pose.R });
const about = (pose, pivot, Q) => ({ pos: add(pivot, apply(Q, sub(pose.pos, pivot))), R: mul(Q, pose.R) });
/** The face whose outward normal points most nearly down. */
const downFace = R => AXES.reduce((best, n, k) => (dot(apply(R, n), DOWN) > dot(apply(R, AXES[best]), DOWN) ? k : best), 0);
/** Where the plane of face k lies along its axis, and the centre's distance to it (its height when it rests on k). */
const facePlane = (s, k) => { const a = k >> 1; return AXES[k][a] > 0 ? s.hi[a] : s.lo[a]; };
const heightOn = (s, k) => Math.abs(facePlane(s, k) - s.com[k >> 1]);

/** The spin (rad/s, world axis times rate) that takes rotation Ra to Rb in one frame at fps; capped at MAX_SPIN, none under MIN_SPIN (a hand's jitter). */
export function spinOf(Ra, Rb, fps) {
	const D = mul(Rb, [[Ra[0][0], Ra[1][0], Ra[2][0]], [Ra[0][1], Ra[1][1], Ra[2][1]], [Ra[0][2], Ra[1][2], Ra[2][2]]]);
	const a = Math.acos(clamp((D[0][0] + D[1][1] + D[2][2] - 1) / 2, -1, 1));
	if (a * fps < MIN_SPIN) return [0, 0, 0];
	const axis = norm([D[2][1] - D[1][2], D[0][2] - D[2][0], D[1][0] - D[0][1]]), rate = Math.min(MAX_SPIN, a * fps);
	return len(axis) > 0 ? scale(axis, rate) : [0, 0, 0];
}

/**
 * The fall through the air from `start` onto the support top: { tl (s), at(t) } with the centre on a parabola, turning at
 * `spin`, leaving at v0 m/s (a throw, flight.js; zero: straight down, as before).
 */
export function airPath(s, start, spin, top, fps, v0 = [0, 0, 0]) {
	const rate = len(spin), com0 = world(start, s.com), still = !v0.some(v => v !== 0);
	const at = t => {
		const R = rate > 0 ? mul(axisRot(spin, deg(rate * t)), start.R) : start.R;
		const fall = still ? [0, -0.5 * G * t * t, 0] : [v0[0] * t, v0[1] * t - 0.5 * G * t * t, v0[2] * t];
		return { pos: sub(add(com0, fall), apply(R, s.com)), R };
	};
	const h = Math.max(0, lowest(s, start) - top);
	if (rate === 0) return { tl: still ? Math.sqrt((2 * h) / G) : flightTime(h, v0[1], G), at };
	// spinning: the first sub-frame step whose lowest corner reaches the top, then halved down to the touch
	const dt = 1 / (fps * 8), cap = (still ? Math.sqrt((2 * (h + len(sub(s.hi, s.lo)))) / G) : flightTime(h + len(sub(s.hi, s.lo)), v0[1], G)) + dt;
	let a = 0, b = dt;
	while (b < cap && lowest(s, at(b)) > top) { a = b; b += dt; }
	for (let i = 0; i < 24 && b - a > 1e-7; i++) { const m = (a + b) / 2; if (lowest(s, at(m)) > top) a = m; else b = m; }
	return { tl: b, at };
}

/** A step's duration (s): gravity-paced by the centre's height and the angle it rolls through. */
const stepTime = (height, angle) => 0.12 + 0.9 * Math.sqrt(Math.max(height, 1e-4) / G) * Math.sqrt(angle / 90);

/**
 * From the pose it lands in, how it rolls to rest on the support top with `energy` (m of drop) to tip over edges:
 * { steps: [{ from, pivot, axis, angle, time }], rest, time }. `lean` (horizontal) is the way a spin tips it: it gives a flat
 * landing the energy and breaks a tie between edges.
 */
export function settlePath(s, impact, top, energy, lean = [0, 0, 0]) {
	const steps = [];
	let pose = snap(s, impact, top), time = 0;
	const push = (pivot, axis, angle) => {
		const height = world(pose, s.com)[1] - top, t = stepTime(height, angle);
		steps.push({ from: pose, pivot, axis, angle, time: t });
		pose = snap(s, about(pose, pivot, axisRot(axis, angle)), top);
		time += t;
	};
	// landed on an edge or a corner: back onto the face nearest down, or over onto the face it leans to when it leans past
	// that edge (more than the angle its centre needs to pass it), rolling about the corners on the support
	let k = downFace(pose.R);
	const tiltOf = j => deg(Math.acos(clamp(dot(apply(pose.R, AXES[j]), DOWN), -1, 1))), tilt = tiltOf(k);
	if (tilt > FLAT) {
		const side = [0, 1, 2, 3, 4, 5].filter(j => j >> 1 !== k >> 1).reduce((a, j) => (tiltOf(j) < tiltOf(a) ? j : a), k === 0 || k === 1 ? 2 : 0);
		if (tilt > deg(Math.atan2(heightOn(s, side), heightOn(s, k)))) k = side;
		const touching = boxCorners(s).map(p => world(pose, p)).filter(p => p[1] <= top + 1e-4);
		const n = apply(pose.R, AXES[k]);
		push(scale(touching.reduce(add, [0, 0, 0]), 1 / touching.length), norm(cross(n, DOWN)), tiltOf(k));
	}
	// over an edge onto a lower face while the landing has the energy, at once from a precarious face (or a centre past the
	// edge); a flat landing with no spin has none
	let left = tilt > FLAT || len(lean) > 0 ? energy : 0;
	for (let i = 0; i < MAX_STEPS; i++) {
		const com = world(pose, s.com), cK = com[1] - top;
		let best = null;
		for (let j = 0; j < 6; j++) {
			if (j >> 1 === k >> 1) continue;
			const out = apply(pose.R, AXES[j]), edge = world(pose, AXES[j].map((v, a) => (v ? facePlane(s, j) : a === k >> 1 ? facePlane(s, k) : s.com[a])));
			const w = -dot(sub(com, edge), out), cJ = heightOn(s, j);
			if (!(w < 0 || cJ < cK * (1 - LOWER))) continue;
			const cost = w < 0 || deg(Math.atan2(w, cK)) < PRECARIOUS ? 0 : Math.hypot(cK, w) - cK, side = dot(out, lean);
			if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && side > best.side)) best = { j, out, edge, cost, side };
		}
		if (!best || best.cost > left) break;
		left -= best.cost;
		const touching = boxCorners(s).map(p => world(pose, p)).filter(p => p[1] <= top + 1e-4 && dot(sub(p, best.edge), best.out) >= -1e-4);
		push(touching.length ? scale(touching.reduce(add, [0, 0, 0]), 1 / touching.length) : [best.edge[0], top, best.edge[2]], norm(cross(best.out, DOWN)), 90);
		k = best.j;
	}
	return { steps, rest: pose, time };
}

/** The pose `u` seconds after it landed, along the settle path: each step rolls about its pivot, accelerating like a fall. */
export function settledAt(path, u) {
	let t = u;
	for (const st of path.steps) {
		if (t < st.time) { const s = t / st.time; return about(st.from, st.pivot, axisRot(st.axis, st.angle * s * s)); }
		t -= st.time;
	}
	return path.rest;
}

/** The energy (m of drop) a spin adds: its kinetic energy over m g, for the box's radius of gyration about its centre. */
export const spinEnergy = (s, spin) => (len(spin) ** 2 * ((s.hi[0] - s.lo[0]) ** 2 + (s.hi[1] - s.lo[1]) ** 2 + (s.hi[2] - s.lo[2]) ** 2)) / (24 * G);
