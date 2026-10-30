// The shape of a motion-scene entry to a hand (#816): a sphere and a cylinder are round, not the box they sit in. A
// 7.4 cm ball in its box is off by up to 30% of its radius at the corners, so fingers closing on the box would stop in
// the air. The shape is derived from what every entry already carries (renderer, half: scene.js), so no field is added
// to an entry and a saved take source, which keeps whole entries, reads the same shapes. DOM-free: the compile worker
// runs it. Everything else (GRAB, COLLIDE, landing) keeps the oriented box.
//   sphere    renderer "sphere" whose three halves agree within EVEN: r = their mean (an uneven one is an ellipsoid:
//             its box)
//   cylinder  renderer "cylinder": its axis along the entry's local +Y, r the smaller cross half, h = 2 half[1]
//   box       anything else: the oriented box on the base pivot (qa/geometry.js sdBox)
// An entry's pos is its base pivot (the bottom centre); its centre is pos + R [0, half[1], 0].
import { add, sub, scale, len, apply, T } from "./compiler/math.js";
import { sdBox, boxNormal, segPoints } from "./qa/geometry.js";

const EVEN = 0.05;

/** { kind: "sphere", r } | { kind: "cylinder", r, h } | { kind: "box" } of a motion-scene entry. */
export function shapeOf(entry) {
	const h = entry?.half;
	if (!h) return { kind: "box" };
	if (entry.renderer === "sphere") {
		const r = (h[0] + h[1] + h[2]) / 3;
		return Math.max(...h) - Math.min(...h) <= EVEN * r ? { kind: "sphere", r } : { kind: "box" };
	}
	if (entry.renderer === "cylinder") return { kind: "cylinder", r: Math.min(h[0], h[2]), h: 2 * h[1] };
	return { kind: "box" };
}

const local = (entry, p) => { const q = apply(T(entry.R), sub(p, entry.pos)); q[1] -= entry.half[1]; return q; };
const centre = entry => add(entry.pos, apply(entry.R, [0, entry.half[1], 0]));

/** Signed distance (m) from p to the entry's shape: negative inside. */
export function signedDistance(entry, p) {
	const s = shapeOf(entry);
	if (s.kind === "sphere") return len(sub(p, centre(entry))) - s.r;
	if (s.kind === "cylinder") {
		const q = local(entry, p), radial = Math.hypot(q[0], q[2]) - s.r, axial = Math.abs(q[1]) - s.h / 2;
		return Math.hypot(Math.max(radial, 0), Math.max(axial, 0)) + Math.min(Math.max(radial, axial), 0);
	}
	return sdBox(p, entry);
}

/** Outward unit normal of the entry's shape at p (the nearest surface's from inside). */
export function normalAt(entry, p) {
	const s = shapeOf(entry);
	if (s.kind === "sphere") { const d = sub(p, centre(entry)), l = len(d); return l > 1e-12 ? scale(d, 1 / l) : apply(entry.R, [0, 1, 0]); }
	if (s.kind === "cylinder") {
		const q = local(entry, p), rq = Math.hypot(q[0], q[2]), radial = rq - s.r, axial = Math.abs(q[1]) - s.h / 2;
		const out = rq > 1e-12 ? [q[0] / rq, 0, q[2] / rq] : [1, 0, 0], cap = [0, Math.sign(q[1]) || 1, 0];
		let n;
		if (radial <= 0 && axial <= 0) n = radial > axial ? out : cap;
		else n = add(scale(out, Math.max(radial, 0)), scale(cap, Math.max(axial, 0)));
		const l = len(n);
		return apply(entry.R, l > 1e-12 ? scale(n, 1 / l) : out);
	}
	return boxNormal(p, entry);
}

export function closestPoint(entry, p) {
	return sub(p, scale(normalAt(entry, p), signedDistance(entry, p)));
}

/**
 * How far a capsule (segment a-b, `radius` m) goes into the entry's shape, m: positive is the depth of its skin inside,
 * negative the gap between its skin and the surface. Sampled on the segment as the QA capsules are (segPoints).
 */
export function capsuleDepth(entry, a, b, radius) {
	let depth = -Infinity;
	for (const p of segPoints(a, b)) depth = Math.max(depth, radius - signedDistance(entry, p));
	return depth;
}
