#!/usr/bin/env node
// Ground contact (lane L2): motion3 QA and verify_result measure the feet on the same sole. The
// live squat-smoke and bat-swing sessions (fixtures/ground-sessions.mjs) got two answers: QA
// clean while verify_result read the Y Bot soles 3.65-3.85 cm under the floor (QA's ball and tip
// rode the ToeBase/Toe_End joints, 3.3 cm above that rig's sole), FLOAT when the agent raised the
// feet, and a back foot whose ball slid 11 cm while it turned on it. Now:
//   1. the rigs' sole landmark (tools/motion3/extract-rig.mjs) puts QA's sole points on the skin;
//      the lowest sole point and the lowest skin vertex agree within the documented tolerance
//      (docs/motion-api-v3.1.md C13) over fpitch -30..60 on both rigs
//   2. fix.slide lifts sunk soles onto the floor: the squats compile QA 0 and verify_result reads
//      under 2 mm of floor penetration and no slip; the raised feet are no FLOAT
//   3. a heel-up foot that turns pivots on its ball and counts as planted: the swing's back foot has no SLIDE, and
//      verify_result's floor and back-foot slip agree; the front foot's flat turn waits until it lifts
//      (lane Q1, fix/turn.js), so the swing is QA 0 as sent; with fix.slide off it is the SLIDE it was,
//      whose hint keys fyaw
// The X Bot keeps its sole points (the car exit's bits, test/bus/verify-motion3-aim.mjs).
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { primeBindPose } from "../../src/poses.js";
import { createIkState, findBone } from "../../src/motion/ik.js";
import { createSupportSampler, supportIntervals } from "../../src/motion/physics-review.js";
import { verifyInstalledTake } from "../../src/studio-agent-motion.js";
import { applyTakeFrame } from "../../src/motion3/playback.js";
import { compileSpec } from "../motion3/fixtures/legacy-compile.mjs";
import { bakeTake } from "../../src/motion3/take.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { solePoints } from "../../src/motion3/qa/geometry.js";
import { specIdOf } from "../../src/motion3/spec-store.js";
import { applyPatch } from "../../src/motion3/json-patch.js";
import * as G from "../motion3/fixtures/ground-sessions.mjs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const rigs = new Map();
function rigOf(model) {
	const bytes = readFileSync(new URL(`../../public/models/${model}.fbx`, import.meta.url));
	const rig = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
	rig.scale.setScalar(0.01); primeBindPose(rig); rig.updateMatrixWorld(true);
	return rig;
}
const probeOf = model => { if (!rigs.has(model)) { const rig = rigOf(model); rigs.set(model, { rig, sample: createSupportSampler(rig) }); } return rigs.get(model); };
const takeOf = (sk, r, spec) => { const t = bakeTake(sk, r.out, { position: [0, 0, 0], yaw: 0 }, { spec }); return { ...t, frames: t.frameCount }; };
/** Per frame and foot: the skin sample of verify_result (lowest vertex, toes) at the take's frame. */
function skinRows(model, motion) {
	const { rig, sample } = probeOf(model), rows = [];
	for (let f = 0; f < motion.frames; f++) {
		applyTakeFrame(rig, motion, f); rig.updateMatrixWorld(true);
		const toes = Object.fromEntries(["Left", "Right"].map(S => [`${S.toLowerCase()}Foot`, findBone(rig, `mixamorig${S}ToeBase`).getWorldPosition(new THREE.Vector3())]));
		rows.push({ support: sample(), toes, ground: {} });
	}
	return rows;
}
const verify = (model, motion, objects) => verifyInstalledTake({ yieldTask: () => Promise.resolve(),
	target: { character: { id: "char-a", x: 0, y: 0, z: 0, rot: 0, scale: 1, model }, rig: rigOf(model), motion, ikState: createIkState() },
	environment: { host: { workspaceId: "w", documentEpoch: "d", sceneId: "s", sceneEpoch: "e" }, physicsRevision: 1, floor: { model: "flat", y: 0 }, objects, cast: [], frameCount: motion.frames } });
const mm = x => +(x * 1000).toFixed(1);

// 1. the sole landmark and the skin agree, both rigs, flat to toe-standing
const xb = skeletonFor("x-bot-tpose"), yb = skeletonFor("y-bot-tpose");
const near = (a, b) => Object.keys(b).every(k => Math.abs(a[k] - b[k]) < 1e-9);
expect("the rigs' sole landmark: X Bot ball 0 / tip -0.7 cm, Y Bot 3.3 / 2.6 cm (m in the skeleton)",
	xb.landmarks.sole.ball === 0 && near(xb.landmarks.sole, { ball: 0, tip: -0.007 }) && near(yb.landmarks.sole, { ball: 0.033, tip: 0.026 }), JSON.stringify([xb.landmarks.sole, yb.landmarks.sole]));
expect("X Bot: the ball sole point is the ToeBase joint itself, bit for bit", (() => {
	const s = compileSpec({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 1, keys: [{ f: 0, set: { fpitch_l: 20 } }] }, { sk: xb, scene: { objects: {} } }).out.frames[0].s;
	return solePoints(xb, s, "Left").ball === s.P[xb.index.LeftToeBase];
})());
const PITCH = [-30, -20, -10, 0, 10, 20, 30, 45, 60];
const gaps = {};
for (const sk of [xb, yb]) {
	const I = sk.index, P = sk.restWorldPos, ank = P[I.LeftFoot][1], hips = P[I.Hips][1];
	const keys = PITCH.map((p, f) => ({ f, set: { root: [0, hips - 0.03, 0], yaw: 0, foot_l: [0.1, ank + 0.06, 0], foot_r: [-0.1, ank + 0.06, 0], fpitch_l: p, fpitch_r: p, fyaw_l: 0, fyaw_r: 35 }, step: ["fpitch_l", "fpitch_r"] }));
	const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: PITCH.length, fix: false, keys }, r = compileSpec(spec, { sk, scene: { objects: {} } });
	const rows = skinRows(sk.model, takeOf(sk, r, spec));
	gaps[sk.model] = PITCH.map((p, f) => Math.max(...["Left", "Right"].map(S => {
		const sp = solePoints(sk, r.out.frames[f].s, S), skin = rows[f].support[`${S.toLowerCase()}Foot`].floor;
		return Math.abs(skin - Math.min(sp.heel[1], sp.ball[1], sp.tip[1]));
	})));
}
console.log(`  |skin - sole| mm by fpitch ${PITCH.join("/")}: X Bot ${gaps["x-bot-tpose"].map(mm).join("/")}, Y Bot ${gaps["y-bot-tpose"].map(mm).join("/")}`);
expect("Y Bot: the lowest sole point is within 3.5 mm of the skin from fpitch -30 to 60", gaps["y-bot-tpose"].every(g => g < 0.0035), JSON.stringify(gaps["y-bot-tpose"].map(mm)));
expect("X Bot: within 1.5 mm from fpitch -10 to 10, within 5 mm toes up, the toe crease within 11 mm on tiptoe (documented)",
	gaps["x-bot-tpose"].every((g, i) => g < (Math.abs(PITCH[i]) <= 10 ? 0.0015 : PITCH[i] < 0 ? 0.005 : 0.011)), JSON.stringify(gaps["x-bot-tpose"].map(mm)));

// 2. the squats: soles lifted onto the floor, QA and verify_result both clean on the floor
const ysk = yb, squat = (spec, objects) => ({ r: compileSpec(spec, { sk: ysk, scene: motionScene(objects) }), objects });
const runs = { squat: squat(G.SQUAT_SPEC, G.smokeScene()), first: squat(G.FIRST_SPEC, G.smokeScene({ x: 0.25, y: 0.3, z: 0.1 }, { x: -0.25, y: 0.3, z: 0.1 })),
	raised: squat(G.RAISED_SPEC, G.smokeScene({ x: 0.25, y: 0.3, z: 0.1 }, { x: -0.25, y: 0.3, z: 0.1 })) };
expect("the fixtures are the specs the sessions installed (specIds)", [["SQUAT", G.SQUAT_SPEC_ID], ["FIRST", G.FIRST_SPEC_ID], ["RAISED", G.RAISED_SPEC_ID], ["SWING", G.SWING_SPEC_ID]]
	.every(([n, id]) => specIdOf(G[`${n}_SPEC`]) === id));
for (const [name, { r }] of Object.entries(runs)) {
	// the scene is the kits alone, and they ride the hands: verify_result measures the soles on the floor, not a
	// hand over a kit box where it waited (the squat's side pockets reach right over the boxes these sessions left at hip height)
	const motion = takeOf(ysk, r, r.spec), v = await verify("y-bot-tpose", motion, []);
	console.log(`  ${name}: QA ${r.qa.total}, fixed ${JSON.stringify(r.fixed)}, verify floor ${mm(v.maxFloorPenetrationM)} mm, slip ${mm(v.maxContactSlipM)} mm`);
	expect(`${name} squat: QA 0, the soles lifted (fixed.ground on all 240 frames), verify_result floor < 2 mm and no slip`,
		r.qa.ok && r.fixed.ground?.frames === 240 && v.maxFloorPenetrationM < 0.002 && v.maxContactSlipM < 0.001, JSON.stringify([r.qa.groups.map(g => g.subject), r.fixed, v.maxFloorPenetrationM, v.maxContactSlipM]));
}
expect("the squat on the balls of the feet is planted all take (output.timeline: heel or ball down and still)",
	["l", "r"].every(k => JSON.stringify(runs.squat.r.timeline[0].planted[k]) === "[[0,239]]"), JSON.stringify(runs.squat.r.timeline[0].planted));
expect("the raised feet are no FLOAT: the skin was still in the floor", !runs.raised.r.qa.groups.some(g => g.kind === "FLOAT") && runs.raised.r.fixed.ground.max > 0.007, JSON.stringify(runs.raised.r.fixed));

// 3. the swing: the back foot pivots on its ball; both measures agree on what is left
const bat = G.batScene(), swing = compileSpec(G.SWING_SPEC, { sk: ysk, scene: motionScene(bat) }), sm = takeOf(ysk, swing, G.SWING_SPEC);
const sv = await verify("y-bot-tpose", sm, bat), spans = supportIntervals(skinRows("y-bot-tpose", sm), 24, [], 0).spans;
const slipOf = (rows, sp) => Math.max(...rows.slice(sp.start, sp.end + 1).map(row => Math.hypot(row.toes[sp.site].x - sp.anchor.x, row.toes[sp.site].z - sp.anchor.z)));
const rows = skinRows("y-bot-tpose", sm), slip = site => Math.max(0, ...spans.filter(sp => sp.site === site).map(sp => slipOf(rows, sp)));
console.log(`  swing: QA ${swing.qa.total} ${JSON.stringify(swing.qa.groups.map(g => [g.subject, g.first, g.last]))}, fixed ${JSON.stringify(swing.fixed)}; verify floor ${mm(sv.maxFloorPenetrationM)} mm, slip ${mm(sv.maxContactSlipM)} mm (right foot ${mm(slip("rightFoot"))}, left ${mm(slip("leftFoot"))})`);
expect("swing: the back foot turns on its ball (fixed.slide.pivots), no SLIDE on the right foot, verify_result floor < 2 mm and right-foot slip < 5 mm",
	swing.fixed.slide?.pivots >= 1 && !swing.qa.groups.some(g => g.subject.startsWith("Right")) && sv.maxFloorPenetrationM < 0.002 && slip("rightFoot") < 0.005,
	JSON.stringify([swing.qa.groups.map(g => g.subject), swing.fixed.slide, sv.maxFloorPenetrationM, slip("rightFoot")]));
expect("swing: the back foot is planted through the pivot (timeline)", swing.timeline[0].planted.r.some(([a, z]) => a <= 36 && z >= 58), JSON.stringify(swing.timeline[0].planted));
// lane Q1: the front foot lands flat at f0 with fyaw_l keyed 5 there and 30 at f36; flat on the floor it keeps 5 deg until it lifts
expect("swing: the front foot's flat turn waits until it lifts (fixed.slide.turns), no SLIDE, verify_result's left-foot slip < 5 mm; QA 0 with every goal held, as sent",
	swing.fixed.slide?.turns?.max > 15 && swing.qa.ok && slip("leftFoot") < 0.005 && swing.qa.goals.every(g => g.ok), JSON.stringify([swing.fixed.slide, swing.qa.groups.map(g => g.subject), slip("leftFoot")]));
const free = compileSpec({ ...G.SWING_SPEC, fix: { ...G.SWING_SPEC.fix, slide: false } }, { sk: ysk, scene: motionScene(bat) });
const left = free.qa.groups.find(g => g.subject === "Left ball slides");
expect("swing with fix.slide off: the front foot's flat turn is the SLIDE it was, the hint keys fyaw_l", left && /^fyaw_l: the flat foot turns/.test(left.hint)
	&& left.patch?.[0]?.value?.set?.fyaw_l !== undefined, JSON.stringify([left?.hint, left?.patch]));
const patched = left?.patch && compileSpec(applyPatch(G.SWING_SPEC, left.patch), { sk: ysk, scene: motionScene(bat) });
expect("swing: that patch (the turn keyed once the foot is up) is QA 0 too, with every goal held", patched?.qa.ok, JSON.stringify(patched?.qa.groups.map(g => g.subject)));

if (failures) { console.error(`${failures} ground-contact check(s) failed`); process.exit(1); }
console.log("motion3 ground contact: all checks passed");
