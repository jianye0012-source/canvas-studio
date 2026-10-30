// The hand a fit puts on a scene body takes a grip on it (lane wrist). A fit only places a point of the
// hand (reachGrip's fingers on the anchor); with nothing asking for the hand's turn, the wrist stayed
// straight on the forearm and kept whatever roll the arm left it, so the palm did not face what it held
// (a box side, a guitar neck: 0 deg of wrist on every holding frame, bench S10, session df388a9b), or
// the agent keyed wflex/wtwist to fix it at the wrist alone. Now, while a fit's weight is on and its
// anchor is on a body (an object anchor's body, or any body within NEAR m of the anchor):
//   fingers  stay on the forearm's line: no flex or deviation is asked (a power grip turns the
//            forearm, not the wrist: the wrist stays in its comfortable middle)
//   roll     the hand turns about the forearm: on a thin body (two half sizes under THIN m: a can, a
//            cup, a bar, a handle, a neck) the knuckle line takes the body's long axis, a cylindrical
//            grasp with the body across the palm, at the end the forearm turns to least; on anything
//            else the end-state-comfort thumb (people take the grip that ends comfortable, Rosenbaum):
//            up when the forearm is level, toward the midline when it points down or up. The turn
//            stops where the forearm's whole twist leaves its comfortable range (arm-orient.js
//            WRIST_COMFORT, +-50 deg: Morrey's daily-task range); the forearm bone takes its share and
//            the wrist the rest (hold.js orient), by the fit's weight
//   point    the fingers' point stays where the fit put it, the elbow in the plane the arm had
// The spec wins: a hand whose wtwist_<k> or wflex_<k> is turned on the frame keeps it, a fit with
// orient: false is left alone, and a prop anchor is the second-hand grip's (second-hand.js). A hand
// that carries something keeps the carry's own grip (its grab offset) once the carry leads it. A keyed
// carry's grab offset is read off the plain solve of its grab frame (object-keys.js attach), so when it
// carries a body that is not thin (a box, a crate) the carrying hand takes the grip on the reach, on
// that frame and up to its first key (ownGrip): the offset the carry keeps is then a grip, not the
// forearm's neutral roll. A thin body (a cup, a can) keeps the neutral offset: its aim keys pick the
// roll the arm holds most easily from it, and the cylindrical grip measured worse on every bench cup.
// Those frames read the carried body where it rested before the grab, never a pose the hand moves.
// An anchor that takes a grasp (an object anchor with `grasp`) turns the hand by its socket instead (socket-grip.js).
import { add, sub, scale, norm, cross, dot, len, apply, ry, mul, T, axisRot } from "./math.js";
import { palmAxes, twoBone } from "./limbs.js";
import { aimArm, orient } from "./hold.js";
import { ELBOW_REST, WRIST_COMFORT, wristNeed } from "./arm-orient.js";
import { resolveAnchor } from "./anchors.js";
import { sdBox } from "../qa/geometry.js";
import { partsOf } from "../object-pose.js";
import { graspAnchor, socketCarry, socketHand, keepSocketTurn, ownWrist } from "./socket-grip.js";

const NEAR = 0.06, UPRIGHT = 0.8, THIN = 0.045, ALIGN = 0.3, PREFER = 30, DEG = 180 / Math.PI, ITER = 2, UP = [0, 1, 0];
const cols = (a, b, c) => [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]];
const flat = (v, n) => sub(v, scale(n, dot(v, n)));

/** The fit of side k whose weight is on most at channels c (null when none), its weight times the arm's IK weight. */
function activeFit(spec, c, k) {
	let best = null;
	for (const fit of spec.fits ?? []) {
		const w = c[`w_${fit.anchor}_${fit.side}`] ?? 0;
		if (fit.side === k && fit.orient !== false && w > 1e-4 && (!best || w > best.w)) best = { fit, w };
	}
	return best && { ...best, w: best.w * Math.min(1, Math.max(0, c[`armw_${k}`] ?? 0)) };
}

/** The fit's effector point on pose s (anchors.js measureProps' rule for a prop point; the joints' mean otherwise). */
function effectorAt(sk, spec, s, side, eff) {
	if (eff.prop) {
		const prop = spec.props?.[eff.prop];
		if (!prop) return null;
		const ax = palmAxes(sk, s, side), o = scale(prop.origin.map(b => s.P[sk.index[b]]).reduce(add, [0, 0, 0]), 1 / prop.origin.length);
		const [d, l, n] = eff.point === "origin" ? [0, 0, 0] : prop.points?.[eff.point] ?? [0, 0, 0];
		return add(o, add(scale(ax.d, d), add(scale(ax.l, l), scale(ax.n, n))));
	}
	const js = eff.joints ?? [`${side}HandIndex2`, `${side}HandMiddle2`];
	return scale(js.map(j => s.P[sk.index[j]]).reduce(add, [0, 0, 0]), 1 / js.length);
}

/** The carry entry over body id (its own or a group's) and the side whose prop carries it, else null. */
function carryOf(ctx, id) {
	const { spec } = ctx, o = ctx.scene?.objects?.[id];
	for (const k of [id, ...(o?.ancestors ?? [])]) { const e = spec.objects?.[k]; if (e?.prop) return { key: k, entry: e, side: spec.props?.[e.prop]?.hand ?? null }; }
	return null;
}

/**
 * Whether hand k takes the grip on keyed carry `key` at frame f although it carries it (see above): a keyed
 * carry that keeps its grab offset, from its reach to its grab frame and up to its first key. Answers the
 * frame to read the carried body at (before the grab), or null.
 */
function ownGrip(ctx, key, k, f) {
	const o = ctx.spec.objects?.[key];
	const half = ctx.scene?.objects?.[key]?.half;
	if (!ctx.hold?.span || !o?.prop || ctx.spec.props?.[o.prop]?.hand !== k || !o.keys?.length || o.grab === undefined || o.at !== undefined || o.along !== undefined || (half && thinAxis(half) >= 0)) return null;
	const [grab] = ctx.hold.span(key);
	return grab >= 1 && f <= Math.max(grab, ctx.hold.firstKey(key) - 1) ? Math.min(f, grab - 1) : null;
}

/** The body box the grip is on: the anchor's object (its nearest part) or the nearest body within NEAR m; null when none. */
function bodyAt(ctx, f, k, A, anchor, now) {
	const scene = ctx.scene?.objects ?? {}, ids = anchor?.kind === "object" ? partsOf(ctx.scene, anchor.object) : Object.keys(scene);
	let best = null;
	for (const id of ids) {
		const half = scene[id]?.half;
		if (!half) continue;
		const own = ownGrip(ctx, carryOf(ctx, id)?.key, k, f), pose = ctx.objectPose?.(id, own ?? f, own === null ? now : null) ?? scene[id];
		if (!pose?.R) continue;
		const box = { pos: pose.pos, R: pose.R, half }, d = sdBox(A, box);
		if (!best || d < best.d) best = { box, d, id };
	}
	// a body this hand carries keeps the carry's own grip (its grab offset, which its keys are written on:
	// the same with keys or without), and no other body takes its place
	const carry = best && carryOf(ctx, best.id);
	if (!best || (carry?.side === k && ownGrip(ctx, carry.key, k, f) === null)) return null;
	return anchor?.kind === "object" || best.d <= NEAR ? { ...best.box, id: best.id } : null;
}

const AXES = [0, 1, 2];
/** The long axis of a thin body (two half sizes under THIN m: a can, a cup, a bar, a handle, a neck), else -1. */
function thinAxis(half) {
	const long = AXES.reduce((a, i) => (half[i] > half[a] ? i : a), 0);
	return AXES.filter(i => i !== long).every(i => half[i] < THIN) ? long : -1;
}

/**
 * The hand's palm frame (columns d, l, n of limbs.js palmAxes) for the grip: the fingers stay on the
 * forearm's line (no flex or deviation added: a power grip turns the forearm, not the wrist) and the
 * hand turns about it. On a thin body the knuckle line takes the body's long axis (a cylindrical grasp:
 * the can, the bar, the neck across the palm) with the thumb at its comfortable end; on anything else,
 * or a thin body along the forearm, the end-state-comfort thumb: up when the forearm is level, toward
 * the midline when it points down or up.
 */
function gripFrame(side, d, now, yawDeg, axis) {
	const right = side === "Right", medial = apply(ry(yawDeg ?? 0), [right ? 1 : -1, 0, 0]), vy = Math.abs(d[1]);
	const thumb = flat(add(scale(UP, 1 - vy), scale(medial, vy)), d), want = norm(len(thumb) > 1e-3 ? thumb : flat(medial, d));
	// a thin body lies across the palm, the knuckle line along its long axis: of its two ends the thumb takes the
	// one the forearm turns to least (the end-state-comfort thumb counts PREFER deg in its favour)
	const across = axis ? flat(axis, d) : null;
	if (!across || len(across) <= ALIGN) return cols(d, want, cross(d, want));
	const turn = l => Math.acos(Math.max(-1, Math.min(1, dot(l, now)))) * DEG - (dot(l, want) > 0 ? PREFER : 0);
	const a = norm(across), l = turn(a) <= turn(scale(a, -1)) ? a : scale(a, -1);
	return cols(d, l, cross(d, l));
}

/** Frame F (columns d, l, n) turned about its own d so the forearm's whole twist (from `twist` deg now) stays within the comfortable range: the roll stops where the forearm is comfortable. */
function comfortable(F, now, twist) {
	const d = [F[0][0], F[1][0], F[2][0]], l = [F[0][1], F[1][1], F[2][1]];
	const want = Math.atan2(dot(cross(now, l), d), dot(now, l)) * DEG, [lo, hi] = WRIST_COMFORT.twist;
	const got = Math.min(hi, Math.max(lo, twist + want)) - twist;
	if (Math.abs(got - want) < 1e-6) return F;
	const r = apply(axisRot(d, got), now);
	return cols(d, r, cross(d, r));
}

/**
 * gripHand(ctx, sk, s, side, k, c, f, diag): turn the hand of a fit onto the body under its anchor
 * (see above); a no-op when nothing asks for it. diag.grip_<k> = { w, twist, flex, dev, body }.
 */
export function gripHand(ctx, sk, s, side, k, c, f, diag) {
	// a wrist the spec turns on this frame is the agent's (or a skill's) own; a neutral 0 asks for nothing
	// a hand that takes a grasp (socket-grip.js) yields only to the agent's own wrist keys, not to a skill's (a walk's swing)
	const on = activeFit(ctx.spec, c, k), carry = socketCarry(ctx, k, f), grasp = on && on.w >= 1e-3 && graspAnchor(ctx.spec, on.fit.anchor);
	if (carry || grasp ? ownWrist(ctx.spec, k) : Math.abs(c[`wtwist_${k}`] ?? 0) > 1e-3 || Math.abs(c[`wflex_${k}`] ?? 0) > 1e-3) return;
	// a hand that holds what it carries by a socket keeps the grasp it took on the grab frame
	if (carry && f > carry.grab) return carry.keyed ? undefined : keepSocketTurn(ctx, sk, s, side, k, carry);
	if (!on || on.w < 1e-3) return;
	if (grasp) return socketHand(ctx, sk, s, side, k, c, diag, on, st => effectorAt(sk, ctx.spec, st, side, on.fit.effector ?? {}), null, f);
	// a hand that carries something on this frame holds that (its carry's grip), whatever its fit's anchor
	if (Object.keys(ctx.spec.objects ?? {}).some(id => ctx.spec.objects[id]?.prop && ctx.objectHand?.(id, f) === k && ownGrip(ctx, id, k, f) === null)) return;
	const now = { s, diag, c }, anchor = ctx.spec.anchors?.[on.fit.anchor];
	// a point of a prop another hand holds is the second-hand grip's (second-hand.js)
	if (anchor?.kind === "prop") return;
	const A = add(resolveAnchor(ctx, on.fit.anchor, s, diag, c, k), on.fit.offset ?? [0, 0, 0]);
	const box = bodyAt(ctx, f, k, A, anchor, now);
	const eff = box && effectorAt(sk, ctx.spec, s, side, on.fit.effector ?? {});
	if (!eff) return;
	const measure = st => ({ pos: effectorAt(sk, ctx.spec, st, side, on.fit.effector ?? {}), R: (({ d, l, n }) => cols(d, l, n))(palmAxes(sk, st, side)) });
	const I = sk.index, a = I[`${side}Arm`], fa = I[`${side}ForeArm`], h = I[`${side}Hand`];
	const long = thinAxis(box.half), axis = long >= 0 ? apply(box.R, AXES.map(i => (i === long ? 1 : 0))) : null;
	// an upright thin body (a cup, a can) under a plain anchor that nothing carries is held the way a grasp holds it
	// (socket-grip.js): a power wrap from the side, not the hand over its top with the fingers down along the forearm
	// (session 7f15b4ae). A carried one keeps its carry's grip, a lying bar or handle the roll rule below.
	if (axis && Math.abs(axis[1]) > UPRIGHT && !carryOf(ctx, box.id)) {
		return socketHand(ctx, sk, s, side, k, c, diag, on, st => effectorAt(sk, ctx.spec, st, side, on.fit.effector ?? {}), { w: { p: A, axis }, type: "power" }, f);
	}
	const ax = palmAxes(sk, s, side), roll = norm(flat(ax.l, ax.d));
	const axT = norm(sub(s.P[h], s.P[fa])), neutral = mul(s.R[fa], mul(T(sk.restWorldRot[fa]), sk.restWorldRot[h]));
	const twist = wristNeed(neutral, s.R[h], axT, apply(mul(neutral, T(s.R[h])), ax.l)).twist;
	const palm = { pos: eff, R: comfortable(gripFrame(side, ax.d, roll, c.yaw, axis), roll, twist) };
	const { goal, plane, wristAt } = aimArm(sk, s, side, palm, measure(s), on.w, "palm");
	let need = { twist: 0, flex: 0, dev: 0 };
	for (let i = 0; i < ITER; i++) {
		// the elbow keeps the plane the arm had (bendPlane), the fingers' point goes back where the fit put it
		twoBone(sk, s, a, fa, h, wristAt(i ? s.R[h] : goal), plane, ELBOW_REST, "elbow");
		need = orient(sk, s, side, h, fa, goal);
	}
	diag[`grip_${k}`] = { w: on.w, ...need };
}
