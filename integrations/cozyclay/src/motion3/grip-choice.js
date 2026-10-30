// The grip a keyed carry keeps (C18, lane pathgrip). Without at/along a carry keeps the palm-object transform of
// its grab frame (object-keys.js attach), and nothing chose that grip: the hand met the object at whatever turn the
// reach left it, and the keys then took the cup to the mouth with the wrist past its comfortable range on 9-47
// frames in 6 of 8 bench S8 takes (50-58 deg of flex and 70 deg of forearm twist at the mouth). A person picks the
// grip for where the object is going (end-state comfort, Rosenbaum), so for a keyed carry whose grip is free the
// grab offset is chosen here over the carry's keyed path:
//   cost      at the grab (the hand takes the grip on the body at rest) and along the keys, the arm's wrist need at
//             the elbow the hold solve takes (arm-orient.js landscape) priced against the comfortable ranges
//             (WRIST_COMFORT: z^2 inside, STEEP to the anatomical limits, OVER past them), plus REACH per squared
//             centimetre the arm is short or folded (a residual QA reports) and BODY per squared centimetre the arm
//             or the hand goes into the body (body.js)
//   faithful  the keys as the compile resolves them (key-aim.js: an aim key without roll at the roll the arm's
//             strain picks), priced every STEP frames; today's grip that keeps every frame comfortable stays
//   search    from today's grip, turns of STEPS degrees about the palm axes (the fingers' line, the palm normal,
//             the knuckle line) while the rough cost (the grab and KEYS keys, an aim key at the best of ROLLS rolls
//             by the strain) drops; the fingers' point stays where the fit put it
//   pick      the found grip only when its faithful cost beats today's by MARGIN or SHARE of it (no flip for less)
// Deterministic. The hand comes into the grip on its reach and leaves it on its release (object-keys.js).
import { sub, scale, norm, len, apply, mul, T, axisRot, matFromQuat, quatFromMat } from "./compiler/math.js";
import { qmul, qrot, qdot, axisQuat, arcQuat, qlog, slerp } from "./compiler/quat.js";
import { aimArm, holdCost } from "./compiler/hold.js";
import { curveOf, keyedPose } from "./object-keys.js";
import { landscape, ELBOW_REST, WRIST_COMFORT, WRIST_LIMITS } from "./compiler/arm-orient.js";
import { bodyFor, segmentDepth } from "./body.js";
import { reachAt, ELBOW_FOLD } from "./compiler/limbs.js";
import { compose, relative } from "./carried.js";

const THIN = 0.045, ROLLS = 4, KEYS = 8, STEPS = [30, 10], TRIES = 2, STEP = 4, MARGIN = 2, SHARE = 0.1, COMFORTABLE = 1.5, REACH = 20, BODY = 4, STEEP = 8, OVER = 400;
// the palm frame's columns (carried.js carriedPose): the fingers' line, the palm normal, the knuckle line (reversed)
const AXES = ["the fingers' line", "the palm normal", "the knuckle line"];
const col = (R, i) => [R[0][i], R[1][i], R[2][i]];
const invert = p => { const Rt = T(p.R); return { pos: scale(apply(Rt, p.pos), -1), R: Rt }; };
const r2 = v => Math.round(v * 100) / 100;

/** The rotation a fraction t of the way from A to B. */
export function between(A, B, t) {
	const a = quatFromMat(A);
	let b = quatFromMat(B);
	if (qdot(a, b) < 0) b = b.map(v => -v);
	return matFromQuat(slerp(a, b, t));
}

/** Price of one wrist turn v (deg) against its comfortable range and anatomical limits. */
function price(v, [clo, chi], [llo, lhi]) {
	const c = v >= 0 ? chi : -clo, L = v >= 0 ? lhi : -llo, a = Math.abs(v);
	if (a <= c) return (a / c) ** 2;
	const e = (Math.min(a, L) - c) / Math.max(1e-6, L - c);
	return 1 + STEEP * e * e + (a > L ? OVER * ((a - L) / L) ** 2 : 0);
}

/** The arm's comfort-priced cost of holding palm frame `palm` on pose s (the plain arm of `side`, `now` its palm frame there). */
function comfortCost(sk, s, side, palm, now) {
	const { goal, plane, wristAt } = aimArm(sk, s, side, palm, now, 1), W = wristAt(goal), land = landscape(sk, s, side, goal, W, plane, ELBOW_REST);
	const arm = land.at(land.softmin()), I = sk.index, S = s.P[I[`${side}Arm`]];
	const A = len(sub(s.P[I[`${side}ForeArm`]], S)), B = len(sub(s.P[I[`${side}Hand`]], s.P[I[`${side}ForeArm`]]));
	const fold = Math.max(0, reachAt(A, B, ELBOW_FOLD) - len(sub(W, S))), body = bodyFor(sk);
	const into = body ? Math.max(segmentDepth(body, sk, s, I[`${side}Arm`], S, arm.elbow), segmentDepth(body, sk, s, I[`${side}ForeArm`], arm.elbow, W), segmentDepth(body, sk, s, I[`${side}Hand`], W, palm.pos)) : 0;
	return ["twist", "flex", "dev"].reduce((c, k) => c + price(arm.need[k], WRIST_COMFORT[k], WRIST_LIMITS[k]), 0) + REACH * ((land.miss * 100) ** 2 + (fold * 100) ** 2) + BODY * (into * 100) ** 2;
}

/** The rough cost of key `key` with offset A: a rot key at its rot; an aim key turned from where the carry holds it (key-aim.js), at its roll or at the best of ROLLS rolls by the arm's strain (hold.js holdCost, as the compile picks it), priced by priceOf. */
function keyCost(sk, s, side, key, now, A, priceOf) {
	if (key.aim === undefined) return priceOf({ pos: key.pos, R: matFromQuat(key.rot) });
	const from = quatFromMat(compose(now, A).R), d = norm(key.aim), q0 = qmul(arcQuat(norm(qrot(from, [0, 1, 0])), d), from);
	const pose = r => ({ pos: key.pos, R: matFromQuat(qmul(axisQuat(d, r), q0)) });
	if (key.roll !== undefined) return priceOf(pose(key.roll));
	let best = null;
	for (let j = 0; j < ROLLS; j++) {
		const p = pose(j * (360 / ROLLS) - 180), strain = holdCost(sk, s, side, compose(p, invert(A)), now);
		if (!best || strain < best.strain) best = { p, strain };
	}
	return priceOf(best.p);
}

/**
 * True when body or group `id` is thin (two half sizes under THIN m: a cup, a can, a bar, a handle); a group by its
 * largest part (a cup with a handle is held by its cup). A box keeps the grip grip.js gives it at the grab.
 */
export function thinBody(scene, id) {
	const parts = Object.entries(scene?.objects ?? {}).filter(([k, o]) => (k === id || o.ancestors?.includes(id)) && o.half);
	if (!parts.length) return false;
	const half = parts.map(([, o]) => o.half).reduce((m, h) => (h[0] * h[1] * h[2] > m[0] * m[1] * m[2] ? h : m));
	const long = [0, 1, 2].reduce((a, i) => (half[i] > half[a] ? i : a), 0);
	return [0, 1, 2].filter(i => i !== long).every(i => half[i] < THIN);
}

/** At most n of the keys, spread over them (the first and the last kept). */
const spread = (keys, n) => (keys.length <= n ? keys : Array.from({ length: n }, (_, i) => keys[Math.round((i * (keys.length - 1)) / (n - 1))]));

/** How the found rotation R differs from today's R0, in words: "today's grip turned 40 deg about the palm normal". */
function named(R0, R) {
	const v = qlog(quatFromMat(mul(T(R0), R))), deg = Math.round((2 * len(v) * 180) / Math.PI), i = [0, 1, 2].reduce((m, j) => (Math.abs(v[j]) > Math.abs(v[m]) ? j : m), 0);
	return `today's grip turned ${deg} deg, mostly about ${AXES[i]}`;
}

/**
 * chooseGrip({ sk, o, side, grab, rest, plain, palmOf, map }) -> { offset, name, cost, today }: the grab offset a
 * keyed carry with a free grip keeps (see above). plain(f) solves frame f without keys, palmOf(s) is the carry's palm
 * frame on a pose, rest the body's pose at the grab, map a key frame to its timeline frame.
 */
export function chooseGrip({ sk, o, side, grab, rest, plain, palmOf, map = f => f }) {
	const solved = new Map(), at = f => { const g = Math.round(f); if (!solved.has(g)) { const s = plain(g); solved.set(g, { s, now: palmOf(s) }); } return solved.get(g); };
	const { s: s0, now: now0 } = at(grab), keys = [...o.keys].sort((a, b) => a.f - b.f), some = spread(keys, KEYS);
	const offsetOf = R => relative({ pos: now0.pos, R }, rest), held = (A, f, pose) => { const { s, now } = at(f); return comfortCost(sk, s, side, compose(pose, invert(A)), now); };
	const grabCost = A => comfortCost(sk, s0, side, compose(rest, invert(A)), now0);
	const rough = R => { const A = offsetOf(R); return grabCost(A) + some.reduce((sum, key) => { const { s, now } = at(map(key.f)); return sum + keyCost(sk, s, side, key, now, A, pose => held(A, map(key.f), pose)); }, 0); };
	const faithful = R => {
		const A = offsetOf(R), t0 = Math.round(map(keys[0].f)), t1 = Math.round(map(keys[keys.length - 1].f));
		const curve = curveOf(o, map, t => quatFromMat(compose(at(t).now, A).R), (t, pos, q, opts) => { const { s, now } = at(t); return holdCost(sk, s, side, compose({ pos, R: matFromQuat(q) }, invert(A)), now, opts); }, 2 * (rest?.half?.[1] ?? 0));
		let cost = grabCost(A), worst = cost;
		for (let f = t0; f <= t1; f += STEP) { const c = held(A, f, keyedPose(curve, f)); cost += c; worst = Math.max(worst, c); }
		return { A, cost, worst };
	};
	// today's grip that keeps every frame comfortable (each turn inside its range) stays as it is
	const today = { name: "today", R: now0.R, ...faithful(now0.R) };
	if (today.worst <= COMFORTABLE) return { offset: today.A, name: "today", cost: r2(today.cost), today: r2(today.cost) };
	let cur = { R: now0.R, rough: rough(now0.R) };
	for (const step of STEPS) {
		for (let tries = 0, better = true; better && tries < TRIES; tries++) {
			better = false;
			for (const i of [0, 1, 2]) for (const sign of [1, -1]) {
				const R = mul(axisRot(col(cur.R, i), sign * step), cur.R), c = rough(R);
				if (c < cur.rough - 1e-6) { cur = { R, rough: c }; better = true; }
			}
		}
	}
	const found = cur.R === now0.R ? today : { name: named(now0.R, cur.R), ...faithful(cur.R) };
	const pick = found.cost < today.cost - Math.max(MARGIN, SHARE * today.cost) ? found : today;
	return { offset: pick.A, name: pick.name, cost: r2(pick.cost), today: r2(today.cost) };
}
