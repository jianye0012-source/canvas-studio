// The arm turns a held object, not the wrist alone (docs/motion-api-v3.1.md C14, lane K8). When a
// hand must take a world rotation (the object leads, hold.js), most of a held object's angle comes
// from the elbow's swivel about the shoulder-wrist axis and from the forearm's turn about its own
// axis (pronation and supination, the twist); the wrist adds the rest (flex and deviation).
//   swivel    the elbow on the circle twoBone can put it on for this wrist: POLES poles are scored
//             and their soft minimum (a Boltzmann-weighted mean pole) taken, so two near-equal
//             poles blend instead of flipping; ../hold-plan.js smooths it over the frames
//   score     each turn's squared share of its range, plus a steep price past the limits, plus a
//             light pull toward the pole the channels gave (a keyed elbow_<side> is a preference)
//             and the same steep price past SWING degrees from it (the upper arm's own roll limit:
//             a straight arm swung half a turn would twist the shoulder, not hold the object)
//   twist     the forearm bone takes FOREARM_SHARE of the turn about the forearm and the hand the
//             rest, so the skin twists along the forearm instead of at the wrist alone
// Everything here is analytic on the pose (no bone moves): twoBone's result does not depend on the
// arm it starts from, so the forearm's frame for a pole is its rest frame aligned onto it.
import { add, sub, scale, norm, dot, cross, len, mul, T, apply, align, clamp, quatFromMat, matFromQuat } from "./math.js";
import { qmul, qconj, qlog, qexp } from "./quat.js";
import { palmAxes, foldPoint, backOf } from "./limbs.js";

/** Wrist limits in degrees, relative to the hand at rest on the forearm (twist: the forearm's turn). */
export const WRIST_LIMITS = { twist: [-85, 85], flex: [-70, 70], dev: [-35, 20] };
/**
 * The comfortable part of each range, what observations.wrist counts frames past (qa/wrist-obs.js):
 * daily tasks keep the wrist within about 40 deg of flex and extension and 25 ulnar / 15 radial
 * deviation (Ryu et al.; Gates et al. 2016) and the forearm within 50 deg of pronation and supination
 * (Morrey 1981).
 */
export const WRIST_COMFORT = { twist: [-50, 50], flex: [-40, 40], dev: [-25, 15] };
/** The share of the turn about the forearm the forearm bone takes (the hand takes the rest). */
export const FOREARM_SHARE = 0.5;
/** The direction an arm's elbow points at rest, carried by the bones (pose.js, twoBone). */
export const ELBOW_REST = [0, 0, -1];
const POLES = 72, TEMP = 0.02, OVER = 400, PULL = 0.5, SWING = 100 / (180 / Math.PI), DEG = 180 / Math.PI;
/**
 * The shoulder's comfort (lane elbow): upper-arm elevation, degrees from hanging straight down (90 level, more
 * the elbow over the shoulder). Daily handling (drinking, eating, a cup or a can at the mouth) keeps the upper
 * arm low and forward, well below the level (Magermans et al. 2005); only overhead work lifts it. A pole pays
 * SHOULDER_PRICE times the squared share of SHOULDER_SPAN it lifts the elbow past SHOULDER_COMFORT on the comfort
 * landscape only (a carry whose aim keys may lean, key-aim.js): priced on every hold, it moved the bench's recompiled
 * cup and can takes into wrist limits and QA (their keys were written for the elbow-up hold).
 */
const SHOULDER_COMFORT = 70, SHOULDER_SPAN = 30, SHOULDER_PRICE = 2;
/** A wrist need's price against the comfortable range first and the limits second (the shape grip-choice.js prices a grip with): 1 at the comfortable edge, steep past it. */
export function comfortPrice(need, steep = 8, over = 400) {
	let cost = 0;
	for (const k of ["twist", "flex", "dev"]) {
		const v = need[k], c = v >= 0 ? WRIST_COMFORT[k][1] : -WRIST_COMFORT[k][0], L = v >= 0 ? WRIST_LIMITS[k][1] : -WRIST_LIMITS[k][0], a = Math.abs(v);
		cost += a <= c ? (a / c) ** 2 : 1 + steep * ((Math.min(a, L) - c) / Math.max(1e-6, L - c)) ** 2 + (a > L ? over * ((a - L) / L) ** 2 : 0);
	}
	return cost;
}

/** The shoulder's price for an elbow at E with the shoulder at S (SHOULDER_COMFORT above). */
export function shoulderPrice(S, E) {
	const u = norm(sub(E, S)), el = Math.acos(clamp(-u[1], -1, 1)) * DEG;
	return SHOULDER_PRICE * (Math.max(0, el - SHOULDER_COMFORT) / SHOULDER_SPAN) ** 2;
}

/** What the hand needs from neutral (its rest on the forearm) to goal, degrees { twist, flex, dev }; axT the forearm axis, l the palm's l axis at neutral. */
export function wristNeed(neutral, goal, axT, l) {
	let q = quatFromMat(mul(goal, T(neutral)));
	if (q[3] < 0) q = q.map(v => -v);
	const twist = 2 * Math.atan2(dot([q[0], q[1], q[2]], axT), q[3]), spin = qexp(scale(axT, twist));
	const swing = qlog(qmul(q, qconj(spin))), lTwisted = apply(matFromQuat(spin), l);
	const axF = norm(sub(lTwisted, scale(axT, dot(lTwisted, axT)))), axD = cross(axT, axF);
	return { twist: twist * DEG, flex: dot(swing, axF) * DEG, dev: dot(swing, axD) * DEG, axF, axD };
}

/**
 * The strain of a wrist need: each turn's squared share of its half range, plus OVER times the
 * squared share past a limit; `margin` (a share of the half range) moves the limits that far in.
 */
function strainOf(need, margin = 0) {
	let cost = 0;
	for (const [k, [lo, hi]] of Object.entries(WRIST_LIMITS)) {
		const z = (need[k] - (lo + hi) / 2) / ((hi - lo) / 2), over = Math.max(0, Math.abs(z) - 1 + margin);
		cost += z * z + OVER * over * over;
	}
	return cost;
}

/**
 * The arm's swivel landscape for hand rotation `goal` with the wrist at W, on pose s (the plain
 * arm of `side`): at(th) -> { pv, need, elbow, cost } for the elbow th radians about the shoulder-wrist
 * axis from `ref` (the bend direction the channels gave), angleOf(world direction) -> th,
 * softmin() -> the th of the Boltzmann-weighted mean of POLES poles, miss the metres the arm is
 * short of W (a wrist nearer the shoulder than the elbow folds is no miss here; hold.js holdCost
 * prices it). `margin` tightens the wrist limits the strain prices (strainOf).
 */
export function landscape(sk, s, side, goal, W, ref, restBend, margin = 0, comfort = false) {
	const I = sk.index, a = I[`${side}Arm`], fa = I[`${side}ForeArm`], h = I[`${side}Hand`], S = s.P[a];
	const A = len(sub(s.P[fa], S)), B = len(sub(s.P[h], s.P[fa]));
	// the elbow where twoBone puts it: the wrist no further folded than limbs.js foldPoint lets it
	const v = sub(foldPoint(S, W, A, B, backOf(sk, s)), S), d = len(v), u = scale(v, 1 / Math.max(d, 1e-9)), dc = clamp(d, Math.abs(A - B) + 1e-4, (A + B) * 0.9995);
	const along = (A * A - B * B + dc * dc) / (2 * dc), rad = Math.sqrt(Math.max(A * A - along * along, 0));
	const off = x => sub(x, scale(u, dot(x, u))), e1 = norm(len(off(ref)) > 1e-6 ? off(ref) : cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
	const e2 = cross(u, e1), Wn = add(S, scale(u, dc));
	const rw = sk.restWorldRot, faDir = apply(T(rw[fa]), sub(sk.restWorldPos[h], sk.restWorldPos[fa])), faBend = apply(T(rw[fa]), restBend);
	const neutralRel = mul(T(rw[fa]), rw[h]), lLocal = apply(T(s.R[h]), palmAxes(sk, s, side).l);
	const at = th => {
		const pv = add(scale(e1, Math.cos(th)), scale(e2, Math.sin(th))), fdir = sub(Wn, add(S, add(scale(u, along), scale(pv, rad))));
		const neutral = mul(align(faDir, faBend, fdir, pv), neutralRel), need = wristNeed(neutral, goal, norm(fdir), apply(neutral, lLocal));
		const z = Math.abs(Math.atan2(Math.sin(th), Math.cos(th))) / SWING;
		const elbow = add(S, add(scale(u, along), scale(pv, rad)));
		// comfort (a carry that lets its aim lean, key-aim.js): the wrist priced against its comfortable range and the shoulder's price
		return { pv, need, elbow, cost: (comfort ? comfortPrice(need) + shoulderPrice(S, elbow) : strainOf(need, margin)) + PULL * (1 - Math.cos(th)) + OVER * Math.max(0, z - 1) ** 2 };
	};
	const angleOf = x => (len(off(x)) > 1e-6 ? Math.atan2(dot(x, e2), dot(x, e1)) : 0);
	const softmin = () => {
		const all = Array.from({ length: POLES }, (_, i) => at((2 * Math.PI * i) / POLES)), low = Math.min(...all.map(p => p.cost));
		const mean = all.reduce((m, p) => add(m, scale(p.pv, Math.exp(-(p.cost - low) / TEMP))), [0, 0, 0]);
		return len(mean) > 1e-3 ? angleOf(mean) : (2 * Math.PI * all.findIndex(p => p.cost === low)) / POLES;
	};
	return { at, angleOf, softmin, miss: Math.max(0, d - dc) };
}

/**
 * The elbow pole for hand rotation `goal` with the wrist at W (landscape above). opts.toward, a
 * world direction, sets the pole instead of the soft minimum (a planned pole, ../hold-plan.js);
 * opts.w (0..1, the keys' blend weight) scales the swing from ref, so the elbow eases out of and
 * back into the plain arm; opts.margin as for landscape. Returns { pole, need, cost, miss }: pole
 * a world direction for twoBone.
 */
export function swivel(sk, s, side, goal, W, ref, restBend, { toward, w = 1, margin = 0, comfort = false } = {}) {
	const land = landscape(sk, s, side, goal, W, ref, restBend, margin, comfort), best = toward ? land.angleOf(toward) : land.softmin();
	const pick = land.at(w * Math.atan2(Math.sin(best), Math.cos(best)));
	return { pole: pick.pv, need: pick.need, cost: pick.cost, miss: land.miss, elbow: pick.elbow };
}
