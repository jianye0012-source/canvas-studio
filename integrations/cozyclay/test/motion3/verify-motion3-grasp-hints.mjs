#!/usr/bin/env node
// Physical grasp (#816), hints: the grasp kinds say why and carry the fix repair applies. The session's ball with
// fix.grasp false is a FINGER_GAP whose patch turns grasp on, and repair applies it (the grasp issues go; the table the
// hand reaches over stays a COLLIDE, printed); a catch that starts late is a CATCH whose patch starts it earlier, and
// repair reaches QA 0 with it.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { buildKit } from "../../src/kits/index.js";
import { repairSpec } from "../../src/motion3/repair.js";
import { BALL_SCENE, ballPickupSpec, MODEL } from "./fixtures/ball-pickup.mjs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` - ${detail}`}`);
	if (!condition) failures += 1;
}
const GRASP = /^(FINGER_PEN|FINGER_GAP|SUPPORT)$/, line = r => r.qa.groups.map(g => `${g.kind}:${g.subject}`).join(" | ");

{
	const sk = skeletonFor(MODEL), scene = motionScene(BALL_SCENE), compile = s => compileSpec(s, { sk, scene }), spec = ballPickupSpec({ fix: { grasp: false } });
	const off = compile(spec), gap = off.qa.groups.find(g => g.kind === "FINGER_GAP" || g.kind === "SUPPORT");
	expect("the ball with fix.grasp false: a FINGER_GAP or SUPPORT group carrying the patch that turns grasp on", JSON.stringify(gap?.patch) === JSON.stringify([{ op: "replace", path: "/fix/grasp", value: true }]), JSON.stringify(gap));
	const fixed = repairSpec(spec, { rounds: 4 }, compile);
	console.log(`  repair: QA ${off.qa.total} -> ${fixed.result.qa.total}, applied ${JSON.stringify(fixed.repair.applied.map(a => a.patch))}; left: ${line(fixed.result) || "none"}`);
	expect("repair applies it: grasp on, no grasp issue left, QA lower", fixed.spec.fix?.grasp === true && !fixed.result.qa.groups.some(g => GRASP.test(g.kind)) && fixed.result.qa.total < off.qa.total, line(fixed.result));
}

{
	const sk = skeletonFor("y-bot-tpose"), kit = buildKit("ball", [], { position: { x: 0, y: 1.6, z: 6 } }), id = kit.rootId, scene = motionScene(kit.records), compile = s => compileSpec(s, { sk, scene });
	const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 64, use: [{ skill: "standIdle", args: { at: [0, 0], heading: 0 }, f0: 0 }, { skill: "catchObject", args: { object: id }, f0: 18 }],
		objects: { [id]: { fall: { at: 12, v: [0, 2.5, -9] } } } };
	const late = compile(spec), miss = late.qa.groups.find(g => g.kind === "CATCH");
	expect("a late catch: CATCH carrying the patch that starts catchObject earlier", miss?.patch?.[0]?.path === "/use/1/f0" && miss.patch[0].value < 18, JSON.stringify(miss));
	const fixed = repairSpec(spec, { rounds: 4 }, compile);
	expect("repair applies it and reaches QA 0", fixed.result.qa.total === 0 && fixed.spec.use[1].f0 < 18, `${line(fixed.result)} f0 ${fixed.spec.use[1].f0}`);
}

if (failures) { console.log(`${failures} grasp hint check(s) failed`); process.exit(1); }
console.log("motion3 grasp hints: all checks passed");
