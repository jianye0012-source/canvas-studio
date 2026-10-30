// Soles on the floor: where a foot's lowest sole point (qa/geometry.js solePoints: heel, ball, tip,
// on the skin's sole, where verify_result measures the floor) is under the floor, its ankle target
// goes up until that point is on the floor. A squat on the balls of the feet (fpitch +) stands on
// the balls instead of sinking them. The sole's shape under the ankle depends only on fyaw and
// fpitch, so the lift is measured at the target, not where an out-of-reach leg left the ankle.
// The lift eases in and out over EASE frames, so a foot keyed into the floor lands, not stops dead.
import { solePoints } from "../qa/geometry.js";
import { SIDES } from "../compiler/pose.js";
import { easeAround, round4 } from "./ease.js";

/** Depth (m) a sole point may keep under the floor; lifts past MAX_LIFT stop there for QA (GROUND). */
const GROUND_EPS = 0.001, MAX_LIFT = 0.15, EASE = 2;

export function liftSoles(out, engine) {
	const { sk } = out.ctx, n = out.frames.length, touched = new Set();
	let worst = 0;
	for (const [k, S] of Object.entries(SIDES)) {
		const ch = out.baked[`foot_${k}`], ankle = sk.index[`${S}Foot`];
		if (!ch) continue;
		const need = out.frames.map(({ s }, i) => {
			const sp = solePoints(sk, s, S), low = Math.min(sp.heel[1], sp.ball[1], sp.tip[1]) - s.P[ankle][1] + ch[out.f0 + i][1];
			return Math.min(MAX_LIFT, -low - GROUND_EPS);
		});
		if (!need.some(d => d > 0)) continue;
		const lift = easeAround(need, EASE);
		for (let i = 0; i < n; i++) {
			if (!(lift[i] > 0)) continue;
			const f = out.f0 + i;
			ch[f] = [ch[f][0], ch[f][1] + lift[i], ch[f][2]];
			worst = Math.max(worst, need[i]);
			touched.add(f);
		}
	}
	if (!touched.size) return null;
	engine.solve([...touched]);
	return { frames: touched.size, max: round4(worst), how: "soles lifted onto the floor" };
}
