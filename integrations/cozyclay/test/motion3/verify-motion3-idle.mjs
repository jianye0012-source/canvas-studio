#!/usr/bin/env node
// The idle layer (src/motion3/compiler/idle.js): a held pose breathes, drifts its head and, standing, shifts its
// weight, so a standing character is never a statue; the feet stay planted, QA stays clean, the take's first frame
// is its keyed pose, and it stays off with spec.idle false, while a hand works, and across a still goal.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { motionScene } from "../../src/motion3/scene.js";
import { dist, add } from "../../src/motion3/compiler/math.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const sk = skeletonFor("y-bot-tpose"), I = sk.index, scene = motionScene([]), json = JSON.stringify;
const spec = (extra = {}) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 240, use: [{ skill: "standIdle", f0: 0, args: { at: [0.4, -0.2], heading: 30 } }], ...extra });
const run = s => compileSpec(s, { sk, scene });
const P = (r, f) => r.out.frames[f].s.P;
const most = (r, j, a, b) => Math.max(...Array.from({ length: b - a }, (_, i) => dist(P(r, a + i + 1)[j], P(r, a + i)[j])));
const range = (r, j, axis, a, b) => { const xs = Array.from({ length: b - a + 1 }, (_, i) => P(r, a + i)[j][axis]); return Math.max(...xs) - Math.min(...xs); };

const live = run(spec()), off = run(spec({ idle: false }));
console.log(`  10 s standing: hips sway ${(range(live, I.Hips, 0, 0, 239) * 100).toFixed(2)} cm, head moves up to ${(most(live, I.Head, 0, 239) * 1000).toFixed(2)} mm a frame; QA ${live.qa.total}`);
expect("standing is not a statue: the hips sway 1-3 cm and the head moves, while idle: false holds every joint still",
	range(live, I.Hips, 0, 0, 239) > 0.01 && range(live, I.Hips, 0, 0, 239) < 0.03 && most(live, I.Head, 0, 239) > 2e-4 && most(off, I.Head, 0, 239) === 0,
	json([range(live, I.Hips, 0, 0, 239), most(live, I.Head, 0, 239), most(off, I.Head, 0, 239)]));
expect("the feet stay planted and QA stays clean", most(live, I.LeftFoot, 0, 239) < 1e-9 && most(live, I.RightFoot, 0, 239) < 1e-9 && live.qa.ok, json(live.qa.groups));
expect("the take starts on its keyed pose: frame 0 is the pose without the layer", P(live, 0).every((p, j) => dist(p, P(off, 0)[j]) < 1e-12));
expect("the same spec bakes the same take", json(run(spec()).out.frames[150].s.P) === json(live.out.frames[150].s.P));
expect("out.baked keeps the keyed values (QA's causes read the keys)", json(live.out.baked.root) === json(off.out.baked.root));

// a working hand holds still: an arm on IK to a target keeps the whole body as keyed
const reach = s => spec({ ...s, keys: [{ f: 0, set: { armw_r: 1, hand_r: add(P(off, 0)[I.RightHand], [0.05, 0.25, 0.2]) } }] });
const working = run(reach()), workingOff = run(reach({ idle: false }));
expect("a hand on IK keeps the body as keyed", working.out.frames.every((fr, f) => fr.s.P.every((p, j) => dist(p, workingOff.out.frames[f].s.P[j]) < 1e-12)));

// a still goal holds the body still over its span
const still = run(spec({ goals: [{ name: "hold still", still: "bone:Head", at: [100, 160] }] }));
expect("a still goal's span is held still, and the goal passes", most(still, I.Head, 100, 160) === 0 && most(still, I.Head, 20, 90) > 0 && still.qa.ok, json([most(still, I.Head, 100, 160), still.qa.groups]));

console.log(failures ? `${failures} motion3 idle check(s) failed` : "motion3 idle: all checks passed");
process.exit(failures ? 1 : 0);
