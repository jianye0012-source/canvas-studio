// Grasp sockets (lane socket): where and how a hand takes hold of an object, so the agent names the part and the
// grasp and the compiler turns the hand. The grasp is the object's (sessions 02263581, 38322b5d: the agent computed
// the wrist by hand and held a barbell 90 deg off, the bar through the palm; a rifle's second hand was measured off
// the first). A socket is, in its record's own axes (metres from the base pivot, as an object anchor's `local`):
//   at     the point the fingers close on
//   axis   the line that runs across the palm, the knuckle line along it (a bar, a handle, a grip); none: any
//   from   the side the hand comes from: the palm faces against it; none: the roll the arm holds most easily
//          (compiler/socket-grip.js), or on a body with no axis the face nearest the point
//   thumb  the end of the axis the thumb takes; none: the end-state-comfort end (socketPalm)
// A record stores named sockets in `grasp` (src/object-grasp.js); every thin body (two half sizes under THIN m: a
// bar, a can, a handle) is one too, named by its id, through its centre along its long axis. An object anchor with
// `grasp` (power, pinch, hook, palm) takes the hand by a socket of its object: `socket` names it, else the one
// nearest the anchor's `local` point or, without one, nearest the shoulder of the hand, picked once per compile.
// A disc (a cylinder whose height is under THIN m and whose two sides are wider: a steering wheel) is a rim socket
// instead: `rim` its radius, `normal` its axis; the hand takes the rim where it is nearest the anchor's `local` point
// or the hand's shoulder, the knuckle line along the rim (session 2ad2760a: the wheel was held by points in the
// driver's frame, 15 cm off the rim, and they did not follow the truck). anchorSocket fixes that point once per hand.
import { add, sub, scale, norm, cross, dot, len, apply, ry, T } from "./compiler/math.js";
import { partsOf } from "./object-pose.js";

const THIN = 0.045, AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const flat = (v, n) => sub(v, scale(n, dot(v, n)));

/** The long axis index of a thin body's half sizes, else -1. */
function thinAxis(half) {
	if (!half) return -1;
	const long = [0, 1, 2].reduce((a, i) => (half[i] > half[a] ? i : a), 0);
	return [0, 1, 2].filter(i => i !== long).every(i => half[i] < THIN) ? long : -1;
}

/** A cylinder flat along its axis (its height under THIN m) and round across it, both sides over THIN m. */
const isDisc = (renderer, half) => renderer === "cylinder" && !!half && half[1] < THIN && Math.min(half[0], half[2]) >= THIN && Math.abs(half[0] - half[2]) < 0.1 * half[0];

/** The record's stored sockets: a body's in scene.objects, a group's (an Empty) in scene.others. */
const stored = (scene, id) => scene?.objects?.[id]?.grasp ?? scene?.others?.[id]?.grasp ?? null;

/**
 * Every socket of body or group `id`: [{ name, owner, at, axis?, from?, thumb? }], each in its owner's axes. The record's
 * own sockets by name; a part's as "<part>.<name>"; a thin part's derived one by the part id.
 */
export function socketsOf(scene, id) {
	const out = [], own = (owner, prefix) => Object.entries(stored(scene, owner) ?? {}).forEach(([name, s]) => out.push({ ...s, name: prefix + name, owner }));
	own(id, "");
	for (const part of partsOf(scene, id)) {
		if (part !== id) own(part, `${part}.`);
		const { half, renderer } = scene.objects[part], long = thinAxis(half);
		// a thin body's radius: the thinner of the two half sizes across the axis (how far the palm sits off the axis)
		if (long >= 0) out.push({ name: part, owner: part, at: [0, half[1], 0], axis: AXES[long], radius: Math.min(...half.filter((_, i) => i !== long)) });
		else if (isDisc(renderer, half)) out.push({ name: part, owner: part, at: [0, half[1], 0], rim: half[0], normal: AXES[1] });
	}
	return out;
}

/** The socket of `id` named `name`, or undefined. */
export const socketNamed = (scene, id, name) => socketsOf(scene, id).find(s => s.name === name);

/** A socket in world space on its owner's pose { pos, R }: { p, axis?, from?, thumb? }. */
export function socketWorld(socket, pose) {
	const dir = v => (v ? norm(apply(pose.R, v)) : undefined);
	return { p: add(pose.pos, apply(pose.R, socket.at ?? [0, 0, 0])), axis: dir(socket.axis), from: dir(socket.from), thumb: dir(socket.thumb), radius: socket.radius,
		...(socket.rim ? { rim: socket.rim, normal: dir(socket.normal) } : {}) };
}

/** The point of world rim socket w nearest world point q, and the rim's direction there: { p, axis }. */
export function rimPoint(w, q) {
	const v = flat(sub(q, w.p), w.normal), r = len(v) > 1e-6 ? norm(v) : norm(flat(Math.abs(w.normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], w.normal));
	return { p: add(w.p, scale(r, w.rim)), axis: norm(cross(w.normal, r)) };
}

/** The outward normal of the face of the box (of boxes [{ pos, R, half }], base pivots) nearest world point p, or undefined. */
export function faceFrom(boxes, p) {
	let best;
	for (const b of boxes) {
		const q = apply(T(b.R), sub(p, add(b.pos, apply(b.R, [0, b.half[1], 0])))), out = [0, 1, 2].map(i => Math.abs(q[i]) - b.half[i]);
		const i = [0, 1, 2].reduce((m, j) => (out[j] > out[m] ? j : m), 0), gap = Math.max(...out);
		if (!best || gap < best.gap) best = { gap, n: scale([b.R[0][i], b.R[1][i], b.R[2][i]], q[i] < 0 ? -1 : 1) };
	}
	return best?.n;
}

/** How far world point q is from a world socket: from its rim, else its axis line through p, else from p. */
export function socketDistance(w, q) {
	const v = sub(q, w.p);
	if (w.rim) return Math.hypot(dot(v, w.normal), len(flat(v, w.normal)) - w.rim);
	return len(w.axis ? flat(v, w.axis) : v);
}

/**
 * The palm frame (columns d, l, n of compiler/limbs.js palmAxes: d to the middle finger, l to the thumb side, n = d x
 * l; the palm is -n on the right hand, +n on the left) a grasp of `type` takes on world socket w, the forearm along fwd,
 * the body turned yawDeg. Along an axis (not a flat palm): with `from` the palm faces against it and the knuckle line
 * runs along the axis; without, the fingers stay on the forearm's line across the axis (a power grip turns the forearm,
 * not the wrist) and the palm closes on it. The thumb takes `thumb`'s end, else the end-state-comfort end (people take
 * the grip that ends comfortable, Rosenbaum): up when the forearm is level, toward the midline when it points down or
 * up. Without an axis the palm faces against `from` (anchorSocket gives a box face's), the fingers on the forearm's line.
 */
export function socketPalm(side, w, type, fwd, yawDeg = 0) {
	const right = side === "Right", sign = v => (right ? v : scale(v, -1));
	// a side along the axis leaves no knuckle line across it: the palm then just faces against the side (below)
	if (w.axis && type !== "palm" && !(w.from && len(flat(w.axis, w.from)) < 1e-3)) {
		if (w.from) {
			const n = sign(w.from), l0 = norm(flat(w.axis, n)), pick = l => (w.thumb ? dot(l, w.thumb) : dot(cross(l, n), fwd));
			const l = pick(l0) >= pick(scale(l0, -1)) ? l0 : scale(l0, -1);
			return cols(cross(l, n), l, n);
		}
		const d = across(fwd, w.axis), medial = apply(ry(yawDeg), [right ? 1 : -1, 0, 0]), vy = Math.abs(d[1]);
		const want = w.thumb ?? flat(add(scale([0, 1, 0], 1 - vy), scale(medial, vy)), d), l0 = norm(flat(w.axis, d));
		const l = dot(l0, want) >= 0 ? l0 : scale(l0, -1);
		return cols(d, l, cross(d, l));
	}
	const n = sign(w.from ?? scale(fwd, -1)), d = across(fwd, n);
	return cols(d, cross(n, d), n);
}

/** fwd made perpendicular to v (unit); any perpendicular when fwd runs along v. */
function across(fwd, v) {
	const d = flat(fwd, v);
	return norm(len(d) > 1e-3 ? d : flat(Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], v));
}

const cols = (a, b, c) => [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]];
