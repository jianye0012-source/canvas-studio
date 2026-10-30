#!/usr/bin/env node
// The walk's natural rhythm (compiler/gait-rhythm.js): a walk no longer gives every step the same
// time. The first steps build up, the last slows into the stop, one side is quicker, no two steps
// are alike; the walk keeps its frames and its end point, compiles to the same QA, and vary: 0
// gives back the even walk exactly.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { walk } from "../../src/motion3/compiler/walk.js";
import { walkRhythm } from "../../src/motion3/compiler/gait-rhythm.js";
import { describe } from "../../src/motion3/describe.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { solePoints } from "../../src/motion3/qa/geometry.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const json = JSON.stringify, sk = skeletonFor("y-bot-tpose"), scene = motionScene([]);
const spec = (args, f0 = 10) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: "auto",
	use: [{ skill: "standIdle", f0: 0, args: { at: [0.3, -0.2], heading: 15 } }, { skill: "walkTo", f0, args }] });
// the frame each step's heel is fully rolled for toe-off: its largest fpitch key, the last of them where the roll reaches
// its limit before the lift (compiler/walk.js rolls the heel up to it; walk-pelvis.js may hold PITCH_MAX a frame or two).
// Only the roll's keys count, the ones that also set the foot's heading (fyaw): the swing's per-frame keys
// (walk-pelvis.js fitSwing) pitch the foot with the shank after the lift and carry no fyaw.
const toeOffs = r => {
	const top = new Map();
	for (const k of r.expanded.keys) {
		if (!/ step \d+$/.test(k.src ?? "") || !Object.keys(k.set).some(c => /^fyaw_/.test(c))) continue;
		for (const [c, v] of Object.entries(k.set)) {
			const t = top.get(k.src);
			if (/^fpitch_/.test(c) && (!t || v > t.v || (v === t.v && k.f > t.f))) top.set(k.src, { v, f: k.f });
		}
	}
	return [...top.values()].map(t => t.f).sort((x, y) => x - y);
};
const gaps = fs => fs.slice(1).map((f, i) => f - fs[i]);
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const restFeet = r => ["Left", "Right"].map(S => { const sp = solePoints(sk, r.out.frames.at(-1).s, S); return [sp.heel, sp.ball].map(p => p.map(v => +v.toFixed(4))); });

// 1. vary 0 is the even walk: every step period frames apart, step metres long
const even = compileSpec(spec({ steps: 8, vary: 0 }), { sk, scene });
expect("vary 0: every toe-off period (20) frames apart, from f0 + 16", json(toeOffs(even)) === json([26, 46, 66, 86, 106, 126, 146, 166]), json(toeOffs(even)));
const flat = walkRhythm({ steps: 6, period: 18, swing: 12, step: 0.6, firstStep: 0.4, lift: 0.08, vary: 0 }, { s0: 0.07, turn: () => 0, seed: "x" });
expect("vary 0: lift offsets i * period, swing in the air, step long, lift high, arms as given", json(flat) === json({ lift: [0, 18, 36, 54, 72, 90], air: [12, 12, 12, 12, 12, 12],
	inc: [0.4, 0.6, 0.6, 0.6, 0.6, 0], height: [0.08, 0.08, 0.08, 0.08, 0.08, 0.08], arm: [1, 1, 1, 1, 1, 1] }), json(flat));

// 2. the default rhythm: uneven, built up at the start, slowed at the end, the same span and end point
const natural = compileSpec(spec({ steps: 8 }), { sk, scene }), g = gaps(toeOffs(natural));
console.log(`  toe-off gaps: even ${json(gaps(toeOffs(even)))}, natural ${json(g)}`);
expect("default: the steps are not all the same length in time", new Set(g).size >= 3, json(g));
expect("default: the first step takes longer than a cruising step", g[0] > median(g.slice(2, -1)), json(g));
const R = walkRhythm({ steps: 8, period: 20, swing: 14, step: 0.5, firstStep: 0.4, lift: 0.08 }, { s0: 0.07, turn: () => 0, seed: "10|8" });
const spans = [...gaps(R.lift), 8 * 20 - R.lift.at(-1)];
expect("default: the closing step takes longer than a cruising step and swings slower", spans.at(-1) > median(spans.slice(2, -2)) && R.air.at(-1) > 14, json({ spans, air: R.air }));
const sideMean = k => { const xs = spans.slice(1, -1).filter((_, i) => (i + 1) % 2 === k); return xs.reduce((a, b) => a + b, 0) / xs.length; };
expect("default: left and right steps do not keep the same time", Math.abs(sideMean(0) - sideMean(1)) > 0.2, json(spans));
const mid = R.inc.slice(1, -1);
expect("default: the middle strides differ and keep their sum", new Set(mid.map(x => x.toFixed(3))).size >= 3 && Math.abs(mid.reduce((a, b) => a + b, 0) - 6 * 0.5) < 1e-9, json(R.inc));
expect("default: the walk keeps its frames", natural.out.frames.length === even.out.frames.length && json(natural.used) === json(even.used), json([natural.used, even.used]));
expect("default: the feet end where the even walk leaves them", json(restFeet(natural)) === json(restFeet(even)), json([restFeet(natural), restFeet(even)]));
const again = compileSpec(spec({ steps: 8 }), { sk, scene });
expect("default: the same spec gives the same walk", json(again.expanded.keys) === json(natural.expanded.keys));

// 3. QA: no worse than the even walk (straight, turning, to a point, a short and a long walk)
for (const args of [{ steps: 8 }, { steps: 8, heading: [15, 105], turnDistance: 1.2 }, { to: [1.5, 2.5] }, { to: [-2, 1] }, { steps: 3 }, { steps: 12 }]) {
	const a = compileSpec(spec({ ...args, vary: 0 }), { sk, scene }).qa, b = compileSpec(spec(args), { sk, scene }).qa;
	expect(`QA ${json(args)}: ${a.total} even, ${b.total} natural, no SLIDE or FLOAT`, b.total <= a.total && !b.groups.some(x => x.kind === "SLIDE" || x.kind === "FLOAT"), json(b.groups.map(x => `${x.kind} ${x.subject} n${x.count}`)));
}

// 4. a turn in the first stride: the turn takes the time the build-up would have
const turn = walkRhythm({ steps: 8, period: 20, swing: 14, step: 0.5, firstStep: 0.4, lift: 0.08 }, { s0: 0.07, turn: (a, b) => (b - a) * 300, seed: "10|8" });
expect("a first stride that turns past 60 deg gets no build-up on top", turn.lift[1] < R.lift[1], json([turn.lift, R.lift]));

// 5. the switch: named, documented, checked
const keys = [{ f: 0, set: { root: [0, 0.99, 0], yaw: 0, foot_l: [0.09, 0.105, -0.03], foot_r: [-0.09, 0.105, 0.03] } }];
let refused = "";
try { walk({ type: "walk", f0: 4, vary: 3 }, keys, sk, "generators[0] walk"); } catch (e) { refused = e.message; }
expect("vary outside 0..2 is refused", refused === "MOTION_SPEC_INVALID: generators[0] walk vary must be a number from 0 (every step the same) to 2, got 3", refused);
const walkTo = describe("essentials").skills.find(s => s.name === "walkTo");
expect("motion.describe lists vary among walkTo's args", /vary\?: number 0\.\.2=1/.test(walkTo.args), walkTo.args);

if (failures) { console.error(`${failures} gait check(s) failed`); process.exit(1); }
console.log("gait: all checks passed");
