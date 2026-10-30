#!/usr/bin/env node
// Physical grasp (#816), catch: catchObject meets a flying ball where the hand can reach and gives with it. A ball thrown
// at f12 from [0, 1.6, 6] at [0, 2.5, -9] m/s toward a body at the origin facing +z is caught on both rigs at QA 0, the
// hand on it at the grab, the ball slowing to a stop over the give; the same throw 1.5 m to the side is refused naming the
// nearest point; a 3 kg ball takes both hands; and a reach that starts 6 frames late misses: QA CATCH.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { buildKit } from "../../src/kits/index.js";
import { objectPoseAt } from "../../src/motion3/object-pose.js";
import { grabGap } from "../../src/motion3/qa/object-checks.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` - ${detail}`}`);
	if (!condition) failures += 1;
}
const LAUNCH = 12;
function caught(rig, { x = 0, f0 = LAUNCH, mass } = {}) {
	const kit = buildKit("ball", [], { position: { x, y: 1.6, z: 6 } }), id = kit.rootId;
	const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 64,
		use: [{ skill: "standIdle", args: { at: [0, 0], heading: 0 }, f0: 0 }, { skill: "catchObject", args: { object: id }, f0 }],
		objects: { [id]: { fall: { at: LAUNCH, v: [0, 2.5, -9] }, ...(mass ? { mass } : {}) } } };
	return { id, run: () => compileSpec(spec, { sk: skeletonFor(rig), scene: motionScene(kit.records) }) };
}

for (const rig of ["y-bot-tpose", "x-bot-tpose"]) {
	const { id, run } = caught(rig), r = run(), grab = r.out.ctx.spec.objects[id].grab, P = f => objectPoseAt(r.out, id, f).pos;
	const step = f => Math.hypot(...P(f).map((v, i) => v - P(f - 1)[i])), travel = Math.hypot(...P(grab + 6).map((v, i) => v - P(grab)[i]));
	const stops = Array.from({ length: 10 }, (_, i) => grab + 1 + i).find(f => step(f) < 0.005), gap = grabGap(r.out, id, grab);
	console.log(`  ${rig}: caught at f${grab}, gap ${(gap * 100).toFixed(1)} cm, ball m/frame ${Array.from({ length: 8 }, (_, i) => step(grab + i).toFixed(3)).join(" ")}, give ${travel.toFixed(3)} m`);
	expect(`${rig}: no CATCH and the hand within 0.03 m of the ball at the grab`, !r.qa.groups.some(g => g.kind === "CATCH") && gap < 0.03, gap);
	expect(`${rig}: the give carries the ball 0.08..0.15 m`, travel >= 0.08 && travel <= 0.15, travel);
	expect(`${rig}: the ball comes to a stop no sooner than 4 frames after the catch`, stops !== undefined && stops - grab >= 4, `${stops}`);
	expect(`${rig}: QA 0`, r.qa.total === 0, r.qa.groups.map(g => `${g.kind}:${g.subject}`).join(" | "));
}

let refusal = "";
try { caught("y-bot-tpose", { x: 1.5 }).run(); } catch (e) { refusal = e.message; }
expect("the same throw 1.5 m to the side is refused, naming its nearest frame and point", /^MOTION_SPEC_INVALID: .*never comes within reach.*nearest at f\d+, \[[-\d., ]+\]/.test(refusal), refusal);

const heavy = caught("y-bot-tpose", { mass: 3 }).run();
expect("a 3 kg ball with side r takes the left hand too", heavy.out.ctx.spec.fits.some(f => f.side === "l") && heavy.out.ctx.spec.fits.some(f => f.side === "r"), JSON.stringify(heavy.out.ctx.spec.fits.map(f => f.side)));

const late = caught("y-bot-tpose", { f0: LAUNCH + 6 }).run(), miss = late.qa.groups.find(g => g.kind === "CATCH");
expect("a catch whose reach starts 6 frames late misses: a CATCH group with the miss in cm", !!miss && /missed by \d+\.\d cm$/.test(miss.subject), late.qa.groups.map(g => `${g.kind}:${g.subject}`).join(" | "));

if (failures) { console.log(`${failures} catch check(s) failed`); process.exit(1); }
console.log("motion3 catch: all checks passed");
