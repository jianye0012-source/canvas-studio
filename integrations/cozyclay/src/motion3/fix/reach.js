// Reach fixes: the legs lower the hips (eased over neighbouring frames) until every ankle target
// is reachable; the arms are clamped inline by pose.js (hooks.softReach), counted here. Both only
// take misses up to 5 cm: anything farther is a staging error that QA must keep reporting.
import { sub, len, dot } from "../compiler/math.js";
import { SIDES, REACH_FIX_MAX } from "../compiler/pose.js";
import { easeAround, round4 } from "./ease.js";

const EASE = 6;

export function lowerHips(out, engine) {
	const { sk } = out.ctx, I = sk.index, P = sk.restWorldPos, root = out.baked.root;
	if (!root) return null;
	const n = out.frames.length, need = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const { s, diag, c } = out.frames[i];
		for (const [k, side] of Object.entries(SIDES)) {
			if (!(diag[`leg_miss_${k}`] > 5e-4) || !Array.isArray(c[`foot_${k}`])) continue;
			const R = 0.999 * (len(sub(P[I[`${side}Leg`]], P[I[`${side}UpLeg`]])) + len(sub(P[I[`${side}Foot`]], P[I[`${side}Leg`]])));
			const v = sub(c[`foot_${k}`], s.P[I[`${side}UpLeg`]]), disc = v[1] * v[1] - dot(v, v) + R * R;
			// hips go down by d so that |v + d*up| = R (the smaller root); sideways misses only get closer
			const d = disc >= 0 ? -v[1] - Math.sqrt(disc) : -v[1];
			if (d > 0 && d <= REACH_FIX_MAX) need[i] = Math.max(need[i], d + 5e-4);
		}
	}
	const frames = need.filter(d => d > 0).length;
	if (!frames) return null;
	const drop = easeAround(need, EASE), touched = [];
	for (let i = 0; i < n; i++) {
		if (!(drop[i] > 0)) continue;
		const f = out.f0 + i, r = root[f];
		root[f] = [r[0], r[1] - drop[i], r[2]];
		touched.push(f);
	}
	engine.solve(touched);
	return { frames, eased: touched.length, max: round4(Math.max(...need)), how: "hips lowered" };
}

/** Frames whose wrist target was past reach and got the soft clamp. */
export function armReach(out) {
	let frames = 0, max = 0;
	for (const fr of out.frames) for (const k of ["l", "r"]) {
		const over = fr.diag[`reach_over_${k}`] ?? 0;
		if (over > 1e-3) { frames++; max = Math.max(max, over); }
	}
	return frames ? { frames, max: round4(max), how: "wrist target clamped to reach" } : null;
}
