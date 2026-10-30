// The knee's stop in QA hints (compiler/limbs.js KNEE_FOLD, KNEE_STOP). An ankle target nearer the hip
// than the knee folds leaves the ankle farther out: under the hip in a squat, down into the floor. So
// REACH leg_miss, GROUND on that foot and KNEE (folds past the stop) say the same thing: the hips are
// lower than the legs fold, bring the root up off the feet (a target above the hip: the foot out from it).
import { sub, scale, norm, len, dist, dot } from "../compiler/math.js";
import { reachAt, KNEE_FOLD, KNEE_STOP } from "../compiler/limbs.js";
import { vec, m3 } from "./fmt.js";

/** What the solver says of a knee on its stop: ` (the knee would fold 168deg; it bends to 150deg and stops at 160deg)`. */
export const kneeWhy = (lead, asked) => ` (${lead}the knee would fold ${Math.round(asked)}deg; it bends to ${KNEE_FOLD}deg and stops at ${KNEE_STOP}deg)`;

/**
 * Hint for leg k at frame f whose ankle point T (the foot_k target, or the drawn ankle) is nearer the
 * hip than the knee folds KNEE_FOLD: the root up by what puts T at that fold's reach when T is under the
 * hip, else foot_k out from the hip by that much. `why` says why (kneeWhy).
 */
export function kneeFoldHint(X, k, f, why, T) {
	const S = k === "l" ? "Left" : "Right", P = X.fr(f).s.P, H = P[X.I[`${S}UpLeg`]], K = P[X.I[`${S}Leg`]], A = P[X.I[`${S}Foot`]];
	const v = sub(T, H), R = reachAt(dist(H, K), dist(K, A), KNEE_FOLD) + 0.002, out = scale(norm(v), Math.max(0, R - len(v)));
	// the hips up by d leave the target R from the hip: |v - d up| = R, the root above the target
	const d = v[1] + Math.sqrt(Math.max(0, v[1] * v[1] - dot(v, v) + R * R));
	if (v[1] < 0) return { cause: X.cause("root", f), hint: `root: raise ${m3(d)} m at f${f}${why}, or key foot_${k} farther from the hip (wider or more forward)`, fix: { channel: "root", f, delta: [0, d, 0] } };
	return { cause: X.cause(`foot_${k}`, f), hint: `foot_${k}: move ${vec(out)} m out from the hip at f${f}${why}, or raise root ${m3(d)} m`, fix: { channel: `foot_${k}`, f, delta: out } };
}
