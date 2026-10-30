#!/usr/bin/env node
// output.observations.near (qa/near.js): how close each hand and foot comes to the nearest scene object,
// measured, not judged. Session df388a9b: a hand meant to strum floated 20 cm in front of a guitar with
// QA clean; session e7edb718: a toe went into a stair's riser during a swing and nothing said so.
// A hand in a box reads a negative gap, the same hand 15 cm in front of it a positive one; the object is
// the top group and the part the body; a foot sunk into a slab is negative; nothing within 0.3 m: no
// near (and no units line); the carrying hand is not measured against what it carries; motion.qa's
// re-measure (opts.checks) answers it too.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { refPoint } from "../../src/motion3/refs.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${JSON.stringify(detail)}`}`);
	if (!condition) failures += 1;
}

const rec = (id, renderer, x, y, z, s, extra = {}) => ({ id, name: id, renderer, x, y, z, rot: 0, rotX: 0, rotZ: 0, scaleX: s[0], scaleY: s[1], scaleZ: s[2], footprint: { width: 1, depth: 1 }, height: 1, ...extra });
const POST = rec("post", "cube", 3, 0, 3, [0.1, 1.2, 0.1]);
const kit = (x, y, z, side) => [rec("kit", "empty", x, 0, z, [1, 1, 1], { footprint: { width: 0, depth: 0 }, height: 0 }), rec("block", "cube", x, y, z, [side, side, side], { parent: "kit" })];
const sk = skeletonFor("y-bot-tpose");
// The right hand held at a body point; no auto-fix, so nothing pushes it out of a box.
const spec = (extra = {}) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 12, fix: false,
	anchors: { rHold: { kind: "body", p: [-0.15, 0.25, 0.35] } },
	keys: [{ f: 0, set: { root: [0, 0.98, 0], armw_r: 1, w_rHold_r: 1 } }], ...extra });
const run = (records, extra, opts) => compileSpec(spec(extra), { sk, scene: motionScene(records) }, opts);

// Where the right palm is with only a far post in the scene: nothing near, no near and no units line.
const alone = run([POST]), palm = refPoint(alone.out, 0, "joint:RightHandMiddle1");
expect("nothing within 0.3 m: no observations.near and no near units", alone.observations.near === undefined && !/near:/.test(alone.observations.units), alone.observations.near);

// A 20 cm block around the palm (base pivot 10 cm below it): the hand is inside, the gap is negative.
const inside = run([POST, ...kit(palm[0], palm[1] - 0.1, palm[2], 0.2)]), rIn = inside.observations.near?.hand_r?.[0];
expect("a hand inside a block reads a negative gap on its top group and part", rIn?.object === "kit" && rIn.part === "block" && rIn.gap[0] < -0.02 && rIn.frames[0] === 0 && rIn.frames[1] === 11, inside.observations.near);
expect("the units say what near is", /near: hand \(palm, fingertips\), foot \(sole\) to the nearest object/.test(inside.observations.units), inside.observations.units);

// The same block 15 cm further out (+z, in front of the hand): the hand floats in front of it.
const front = run([POST, ...kit(palm[0], palm[1] - 0.1, palm[2] + 0.35, 0.2)]), rOut = front.observations.near?.hand_r?.[0];
expect("the hand in front of the block reads a positive gap, within 0.3 m", rOut?.object === "kit" && rOut.gap[0] > 0.02 && rOut.gap[2] < 0.3, front.observations.near);

// A 10 cm slab from 5 cm below the floor to 5 cm above it: the standing soles are inside it; a body with no group is its own object.
const slab = run([POST, rec("slab", "cube", 0, -0.05, 0, [1, 0.1, 1])]), feet = slab.observations.near ?? {};
expect("feet sunk into a slab read negative gaps; a lone body has no part key", ["foot_l", "foot_r"].every(k => feet[k]?.[0]?.object === "slab" && !("part" in feet[k][0]) && feet[k][0].gap[0] < 0), feet);
expect("at most 2 runs per hand or foot", Object.values(feet).every(rows => rows.length <= 2), feet);

// The right hand carries the block from frame 0: hand_r is measured against everything else.
const carried = run([POST, ...kit(palm[0], palm[1] - 0.1, palm[2], 0.2)], {
	props: { grip: { hand: "r", origin: ["RightHandIndex1", "RightHandMiddle1"], points: { tip: [0, 0, 0] } } },
	objects: { kit: { prop: "grip", at: [0, 0.05, 0], along: [0, 1, 0] } } });
expect("the carrying hand is not measured against what it carries", !(carried.observations.near?.hand_r ?? []).some(r => r.object === "kit"), carried.observations.near);

// motion.qa re-measures with opts.checks: the same observation.
const remeasure = run([POST, ...kit(palm[0], palm[1] - 0.1, palm[2], 0.2)], {}, { checks: {} });
expect("a re-measure (motion.qa) answers near too", remeasure.observations.near?.hand_r?.[0]?.object === "kit", remeasure.observations.near);

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("PASS nearest-object observation");
