#!/usr/bin/env node
// Physical grasp (#816), QA: a hand that does not hold what it carries is an issue. Session 7f15b4ae's ball rode the
// finger middles, through them, at QA 0; FINGER_PEN, FINGER_GAP and SUPPORT now see it. A hand that holds nothing and a
// carry pinned with at/along and no grasp (the exit-car cigarette) are not judged.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { graspChecks, heldSpans } from "../../src/motion3/qa/grasp-checks.js";
import { BALL_SCENE, BALL, ballPickupSpec, MODEL } from "./fixtures/ball-pickup.mjs";
import { EXITCAR_SPEC, SCENE_OBJECTS, CHARACTER } from "./fixtures/exitcar-scene.mjs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` - ${detail}`}`);
	if (!condition) failures += 1;
}
const sk = skeletonFor(MODEL), scene = motionScene(BALL_SCENE);
const kinds = r => r.qa.groups.filter(g => /^(FINGER_PEN|FINGER_GAP|SUPPORT)$/.test(g.kind));
const line = gs => gs.map(g => `${g.kind} ${g.subject} f${g.first}-${g.last} worst ${g.worst}`).join("; ");

// the session's ball as today's compiler holds it (fix.grasp false: the preset grip, the grab-frame offset), judged
const old = compileSpec(ballPickupSpec({ fix: { grasp: false } }), { sk, scene });
const judged = graspChecks(sk, { ...old.out, ctx: { ...old.out.ctx, spec: { ...old.out.ctx.spec, fix: undefined } } });
const found = [...new Set(judged.map(i => i.kind))].map(kind => ({ kind, subject: judged.find(i => i.kind === kind).msg, first: Math.min(...judged.filter(i => i.kind === kind).map(i => i.frame)), last: Math.max(...judged.filter(i => i.kind === kind).map(i => i.frame)), worst: 0 }));
console.log("  glued ball: " + line(found));
expect("the session's glued ball is a grasp issue (finger pen, gap or support)", found.some(g => /^FINGER_|^SUPPORT$/.test(g.kind)), line(old.qa.groups));
expect("its grasp issues start no earlier than the grab (f30) and run to the end", found.every(g => g.first >= 30), line(found));
const now = compileSpec(ballPickupSpec(), { sk, scene });
expect("the ball is judged with the spherical grasp a ball takes", heldSpans(now.out).some(h => h.id === BALL && h.grasp === "spherical" && h.k === "r"));

// fix.grasp false: the preset grip is judged as the carry grasp physics would seat (its hint turns grasp back on)
const off = compileSpec(ballPickupSpec({ fix: { grasp: false } }), { sk, scene });
expect("fix.grasp false: the preset grip on the ball is a grasp issue", kinds(off).some(g => /^FINGER_|^SUPPORT$/.test(g.kind)), line(kinds(off)));

// a hand that holds nothing: the same reach without the carry
const empty = ballPickupSpec(); delete empty.objects;
const reach = compileSpec(empty, { sk, scene });
expect("a hand that holds nothing has no grasp issue", graspChecks(sk, reach.out).length === 0 && kinds(reach).length === 0, line(kinds(reach)));

// a pinned carry without a grasp type (the exit-car cigarette and lighter) is not on the grasp path: exitcar stays QA 0
const car = compileSpec({ fps: 24, ...JSON.parse(JSON.stringify(EXITCAR_SPEC)) }, { sk: skeletonFor(CHARACTER.model), scene: motionScene(SCENE_OBJECTS) });
expect("exit car: no grasp issue and QA 0", kinds(car).length === 0 && car.qa.total === 0, `${car.qa.total} ${line(car.qa.groups.slice(0, 3))}`);

if (failures) { console.log(`${failures} grasp QA check(s) failed`); process.exit(1); }
console.log("motion3 grasp QA: all checks passed");
