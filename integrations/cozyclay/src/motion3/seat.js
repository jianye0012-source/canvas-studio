// A carried object rests in the hand that holds it (#816). Without at/along it kept the transform it had against the
// prop origin, the finger middles, at the grab frame: session 7f15b4ae's ball rode 2.4 cm off them, the index and middle
// 3 cm inside it, and closing the fingers would move that origin with them. On the grasp path (a carry with no at/along,
// or naming a carry grasp) with fix.grasp on:
//   frame  the palm frame stands on the Hand bone: the prop origin where the bind pose has it against the hand, so
//          closing fingers move nothing they hold (carried.js carriedPose `fixed`)
//   seat   the grab-frame offset slides along the palm normal until the palm and the knuckles just touch the object
//          (their skin TOUCH m off it): found once per offset by bisection on the bind hand, no frame is solved for it
//   settle over SETTLE frames from the grab the object eases from where it rests into its seat (smoothstep)
import { add, sub, scale, apply, T } from "./compiler/math.js";
import { restState } from "./compiler/skeleton.js";
import { SIDES } from "./compiler/pose.js";
import { carriedPose, compose, relative } from "./carried.js";
import { capsuleDepth, shapeOf } from "./shapes.js";

const TOUCH = 0.002, PALM = 0.022, KNUCKLE = 0.012, NEAR = 0.04, FAR = 0.15, STEPS = 12;
export const SETTLE = 4;

/**
 * True when carry entry o of body or group `id` rests in its hand: grasp physics on, and a carry grasp named, or no pinned
 * at/along on one round body (a ball, a can: shapes.js). A box or a kit carried without a grasp keeps its grab-frame offset
 * (a lantern hangs from its handle; sliding it onto the palm would push it off the fingers).
 */
export const seatsInHand = (spec, o, scene, id) => spec?.fix !== false && spec?.fix?.grasp !== false && !!o?.prop
	&& (o.grasp !== undefined || (o.at === undefined && o.along === undefined && roundBody(scene, id)));
function roundBody(scene, id) {
	const parts = Object.entries(scene?.objects ?? {}).filter(([k, e]) => k === id || e.ancestors?.includes(id));
	return parts.length === 1 && shapeOf(parts[0][1]).kind !== "box";
}

const seats = new WeakMap();

/**
 * The offset (in the palm frame of carry o's prop) that seats body or group `id` against the palm: `offset` moved along
 * the palm normal until the palm (Hand to Middle1) and the knuckles (Index1 to Pinky1) touch it from outside.
 */
export function seatOffset(sk, spec, scene, id, o, offset) {
	if (!seats.has(scene)) seats.set(scene, new Map());
	const cache = seats.get(scene), key = `${id}|${o.prop}|${offset.pos.map(v => v.toFixed(6)).join(",")}`;
	if (cache.has(key)) return cache.get(key);
	const prop = spec.props[o.prop], side = SIDES[prop.hand], s0 = restState(sk), frame = carriedPose(sk, spec, s0, { prop: o.prop }, true);
	const local = p => apply(T(frame.R), sub(p, frame.pos)), J = n => local(s0.P[sk.index[`${side}${n}`]]);
	const hand = [[J("Hand"), J("HandMiddle1"), PALM], [J("HandIndex1"), J("HandPinky1"), KNUCKLE]];
	const root = restOf(scene, id), parts = Object.entries(scene.objects).filter(([k, e]) => k === id || e.ancestors?.includes(id));
	// slide along the palm normal (the frame's y column): out of the hand when the object is in it, in toward it when it
	// floats off it, whichever way the depth falls; stop where the skin is TOUCH off it
	const y = [0, 1, 0], depthAt = u => {
		const at = { pos: add(offset.pos, scale(y, u)), R: offset.R };
		let d = -Infinity;
		for (const [, e] of parts) {
			const entry = { ...e, ...compose(at, relative(root, e)) };
			for (const [a, b, r] of hand) d = Math.max(d, capsuleDepth(entry, a, b, r));
		}
		return d;
	};
	// out of the hand is the palm's side: -n on the right hand, +n on the left (limbs.js palmAxes), the frame's y column n
	const d0 = depthAt(0), outward = prop.hand === "l" ? 1 : -1, inside = d0 > -TOUCH;
	// inside: the answer lies outward within FAR; floating: inward within NEAR (never past the touch)
	let lo = 0, hi = inside ? FAR : NEAR;
	const sign = inside ? outward : -outward;
	if (inside || depthAt(sign * hi) > -TOUCH) {
		for (let i = 0; i < STEPS; i++) { const mid = (lo + hi) / 2; if ((depthAt(sign * mid) > -TOUCH) === inside) lo = mid; else hi = mid; }
	} else lo = 0;
	const seated = { pos: add(offset.pos, scale(y, sign * (inside ? hi : lo))), R: offset.R };
	cache.set(key, seated);
	return seated;
}

/** The rest pose { pos, R } of a body or a group root (a group: its parts' ancestor pose). */
export function restOf(scene, id) {
	const e = scene.objects[id];
	if (e) return { pos: e.pos, R: e.R };
	const g = Object.values(scene.objects).find(x => x.ancestors?.[0] === id);
	return g?.ancestorPoses?.[0] ?? { pos: [0, 0, 0], R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
}

/** How far into its seat a carried object is at absolute frame f (0 at the grab, 1 from SETTLE frames on). */
export function settleAt(grab, f) {
	const t = Math.min(1, Math.max(0, (f - grab) / SETTLE));
	return t * t * (3 - 2 * t);
}

/** The world pose between `from` and `to` (same turn: the seat only slides), t of the way. */
export const between = (from, to, t) => ({ pos: add(from.pos, scale(sub(to.pos, from.pos), t)), R: to.R });
