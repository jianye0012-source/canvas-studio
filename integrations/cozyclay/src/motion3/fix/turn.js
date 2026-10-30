// A planted flat foot keeps its heading (lane Q1). While both its heel and its ball are planted
// (QA's definition: under plantH over the ground, qa/ground.js, and still), the foot cannot turn without one of them sliding: a
// flat foot under the body's weight grips the floor. A turn the channels ask for then (fyaw_<k>, or
// the body's yaw when fyaw_<k> is not keyed) waits: the foot keeps the heading it planted with
// until its heel or its toes come up or it lifts, and then eases onto the keyed heading at about
// TURN_RATE degrees a frame. With the heel up it turns on its ball (slide.js holds the ball and
// pivots the foot there), in the air it turns freely. Session 4db5d447: fyaw_r keyed 0 at f0 and
// 30 at f37 turned the flat back foot 9 deg over the load (f10-19), and its heel slid 2.2 cm.
// A foot that turns only while a heel or ball is up, and a flat foot that does not turn, are left
// as they were.
import { QA_LIMITS } from "../qa/checks.js";
import { groundSole } from "../qa/ground.js";
import { round4 } from "./ease.js";

const TURN_RATE = 6, DECAY = 4, TOL = 1;
const smooth = t => t * t * (3 - 2 * t);

/** Holds the heading of flat planted feet (fyaw_<k>), eases it onto the keys once a heel or ball is up; re-solves those frames. */
export function holdTurns(out, engine) {
	const n = out.frames.length, H = QA_LIMITS.plantH, touched = new Set();
	let worst = 0;
	for (const [k, S] of [["l", "Left"], ["r", "Right"]]) {
		const keyed = out.baked[`fyaw_${k}`] ?? out.baked.yaw;
		if (!out.baked[`foot_${k}`] || !keyed) continue;
		const sole = out.frames.map((_, i) => groundSole(out, i, S));
		const down = (i, key) => sole[i][key][1] < H && sole[i - 1][key][1] < H && Math.abs(sole[i][key][1] - sole[i - 1][key][1]) < 0.0005;
		const flat = i => i > 0 && i < n && down(i, "heel") && down(i, "ball");
		const want = Array.from({ length: n }, (_, i) => keyed[out.f0 + i]), yaw = want.slice();
		for (let i = 1; i < n; i++) {
			if (!flat(i)) continue;
			const held = yaw[i - 1];
			let j = i, turn = 0;
			for (; flat(j); j++) turn = Math.max(turn, Math.abs(yaw[j] - held));
			// a turn within TOL degrees (the heel moves under 3 mm) is left as it is
			if (turn <= TOL) { i = j; continue; }
			worst = Math.max(worst, turn);
			for (let m = i; m < j; m++) yaw[m] = held;
			// then onto the keyed heading, as long as the foot does not plant flat again
			const gap = j < n ? want[j] - held : 0, ease = Math.max(DECAY, Math.ceil(Math.abs(gap) / TURN_RATE));
			for (let m = 0; gap && m < ease && j + m < n && !flat(j + m); m++) yaw[j + m] = want[j + m] - gap * (1 - smooth((m + 1) / (ease + 1)));
			i = j;
		}
		const moved = yaw.map((v, i) => v !== want[i]);
		if (!moved.some(Boolean)) continue;
		const ch = (out.baked[`fyaw_${k}`] = keyed.slice());
		moved.forEach((m, i) => { if (m) { ch[out.f0 + i] = yaw[i]; touched.add(out.f0 + i); } });
	}
	if (!touched.size) return null;
	engine.solve([...touched]);
	return { frames: touched.size, max: round4(worst) };
}
