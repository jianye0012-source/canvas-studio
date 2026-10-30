#!/usr/bin/env node
// Lane S1: arms kept out of the body on its fitted skin. The body (body.js, from the rigs' skin:
// tools/motion3/extract-body.mjs), QA's BODY on it (qa/body-checks.js) and the self fix (fix/self.js,
// compile.js keepOut): what the fixtures had before, what they have with fix.self (the default).
import { readFileSync } from "node:fs";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { legacySpec } from "./fixtures/legacy-compile.mjs";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { restState } from "../../src/motion3/compiler/skeleton.js";
import { bodyFor, bodyDistance, keepOut, limbDepth, HAND_CLEAR } from "../../src/motion3/body.js";
import { ARM_BONES } from "../../src/motion3/qa/body-checks.js";
import { motionScene } from "../../src/motion3/scene.js";
import { EXITCAR_SPEC, SCENE_OBJECTS, CHARACTER } from "./fixtures/exitcar-scene.mjs";
import { SPEC_EXAMPLES } from "../../src/motion3/schema/spec-examples.js";
import { buildKit } from "../../src/kits/index.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const cm = x => +(x * 100).toFixed(1);
/** Frames with an arm more than `past` m into the rest of the body, and the deepest (m), on the fitted skin. */
function overlap(sk, out, past = 0.01) {
	const body = bodyFor(sk);
	let frames = 0, max = 0;
	for (const { s } of out.frames) {
		const d = Math.max(...ARM_BONES.map(n => limbDepth(body, sk, s, sk.index[n]).depth));
		if (d > past) frames++;
		max = Math.max(max, d);
	}
	return { frames, max };
}

// 1. the body: the skin of each bone within millimetres, the arms clear of it at rest
for (const rig of ["y-bot-tpose", "x-bot-tpose"]) {
	const sk = skeletonFor(rig), body = bodyFor(sk), s = restState(sk), I = sk.index, P = sk.restWorldPos;
	const chest = P[I.Spine2], head = P[I.Head];
	expect(`${rig}: 22 bone grids and limb radii from the skin`, body.grids.length === 22 && ARM_BONES.every(n => body.radii[I[n]]?.length === 6));
	expect(`${rig}: inside the chest, outside 30 cm ahead of it, inside the head`, bodyDistance(body, s, chest).d < -0.03 && bodyDistance(body, s, [chest[0], chest[1], chest[2] + 0.3]).d > 0.05
		&& bodyDistance(body, s, head).d < -0.01, JSON.stringify([bodyDistance(body, s, chest).d, bodyDistance(body, s, head).d]));
	expect(`${rig}: no arm in the body at bind`, ARM_BONES.every(n => limbDepth(body, sk, s, I[n]).depth <= 0.005));
	// a wrist target 5 cm ahead of the spine (inside the chest; on the spine's axis itself no side is out),
	// out of one bone at a time, twice at most, as compile.js calls it
	const inChest = [chest[0], chest[1], chest[2] + 0.05], moved = keepOut(body, sk, s, keepOut(body, sk, s, inChest, HAND_CLEAR), HAND_CLEAR);
	expect(`${rig}: keepOut takes a point inside the chest onto the skin, ${cm(HAND_CLEAR)} cm off it`, Math.abs(bodyDistance(body, s, moved).d - HAND_CLEAR) < 0.01, JSON.stringify(bodyDistance(body, s, moved)));
}

// 2. the car exit (730 frames): its arms were in the thighs and the chest on a third of the frames
// QA WRIST (qa/wrist-checks.js) stays clear: an elbow fix.self turns about the shoulder-wrist line stops the smoking
// wrist at its limit and the hand turns on with it, the fit keeping the filter at the lips (compiler/wrist-clamp.js).
const dsk = skeletonFor(CHARACTER.model), car = motionScene(SCENE_OBJECTS);
const before = compileSpec({ fps: 24, ...legacySpec(EXITCAR_SPEC) }, { sk: dsk, scene: car }), after = compileSpec({ fps: 24, ...EXITCAR_SPEC }, { sk: dsk, scene: car });
const ob = overlap(dsk, before.out), oa = overlap(dsk, after.out);
console.log(`  car exit: arm in the body on ${ob.frames} frames (deepest ${cm(ob.max)} cm) -> ${oa.frames} (${cm(oa.max)} cm); fixed.self ${JSON.stringify(after.fixed.self)}`);
expect("car exit: fix.self takes the arms out of the body (>= 200 frames -> <= 15, deepest < 7 cm) at QA 0, no WRIST", ob.frames >= 200 && oa.frames <= 15 && oa.max < 0.07 && after.qa.ok, JSON.stringify(after.qa.groups.map(g => [g.subject, g.count])));
expect("car exit: QA's BODY sees what the old QA did not (the same take without fix.self)", compileSpec({ fps: 24, ...EXITCAR_SPEC, fix: { ...(EXITCAR_SPEC.fix ?? {}), self: false } }, { sk: dsk, scene: car }).qa.groups.some(g => g.kind === "BODY"));
expect("car exit: the elbow turns and the hand pushes are reported, and the steering wheel is left alone", after.fixed.self?.elbowFrames > 0 && !after.qa.groups.some(g => g.kind === "COLLIDE"));

// 3. the squat smoke of the docs, with kits: the arms out of the thighs and the chest, the filter still on the lips
const rename = (records, map) => records.map(r => ({ ...r, id: map[r.id] ?? r.id, ...(r.parent ? { parent: map[r.parent] ?? r.parent } : {}) }));
const kit = (name, id, existing = [], position = {}) => { const k = buildKit(name, existing, { position }); return rename(k.records, { [k.rootId]: id }); };
const cig = kit("cigarette", "cig", [], { x: 0.6, z: 0.5 }), lit = kit("lighter", "lighter", cig, { x: 0.75, z: 0.5 });
const smoke = motionScene([...cig, ...lit, ...kit("exhale", "exhale", [...cig, ...lit])]), squat = SPEC_EXAMPLES.find(e => e.name.startsWith("squat")).spec;
for (const rig of ["y-bot-tpose", "x-bot-tpose"]) {
	const sk = skeletonFor(rig), was = compileSpec(legacySpec(squat), { sk, scene: smoke }), now = compileSpec(squat, { sk, scene: smoke });
	// past 4 cm: a hand in a side pocket touches the thigh (the skill allows that much); lighting, the hands touch
	const o0 = overlap(sk, was.out, 0.04), o1 = overlap(sk, now.out, 0.04);
	console.log(`  squat smoke ${rig}: arm over 4 cm into the body on ${o0.frames} frames (deepest ${cm(o0.max)} cm) -> ${o1.frames} (${cm(o1.max)} cm)`);
	expect(`squat smoke ${rig}: an arm over 4 cm into the body on >= 50 frames before, none with fix.self; QA 0 (no WRIST), cigarette at the mouth`,
		o0.frames >= 50 && o1.frames === 0 && now.qa.ok && now.qa.goals.every(g => g.ok), JSON.stringify([o0, o1, now.qa.groups.map(g => g.subject)]));
}

// 4. a measured target stays: the flame 2 cm under the cigarette tip is not moved by the fix
const ysk = skeletonFor("y-bot-tpose"), Y = ysk.index, YP = ysk.restWorldPos, ank = YP[Y.LeftFoot][1];
const stand = { root: [0, YP[Y.Hips][1] - 0.01, 0], foot_l: [0.09, ank, 0], foot_r: [-0.09, ank, 0] };
const lit2 = compileSpec({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 1, keys: [{ f: 0, set: { ...stand, armw_r: 1, armw_l: 1, hand_r: [0, 1.25, 0.3], w_under_l: 1 } }],
	props: { cig: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { tip: [0, 0, 0.058] } }, lighter: { hand: "l", origin: ["LeftHand", "LeftHandMiddle1"], points: { flame: [0.01, 0.036, 0] } } },
	anchors: { under: { kind: "prop", prop: "cig", point: "tip", offset: [0, -0.02, 0] } }, fits: [{ side: "l", anchor: "under", effector: { prop: "lighter", point: "flame" } }] }, { sk: ysk, scene: { objects: {} } }).out.frames[0].diag.props;
const gap = Math.hypot(lit2.lighter.flame[0] - lit2.cig.tip[0], lit2.lighter.flame[1] - (lit2.cig.tip[1] - 0.02), lit2.lighter.flame[2] - lit2.cig.tip[2]);
expect("a fit's target and the prop it hangs off are not moved: the flame stays 2 cm under the tip (<= 1 mm)", gap < 0.001, String(gap));

// 5. the agent's night squat smoke (session db4b6878), as installed: QA 0, no arm in the body past the lighting
const src = JSON.parse(readFileSync(new URL("./fixtures/self-smoke-take.json", import.meta.url), "utf8")), ssk = skeletonFor(src.rig);
const night = compileSpec({ fps: 24, ...src.spec }, { sk: ssk, scene: src.scene }, { lenient: true }), on = overlap(ssk, night.out, 0.04);
console.log(`  the agent's night smoke: QA ${night.qa.total} ${JSON.stringify(night.qa.groups.map(g => g.subject))}, arm over 4 cm in on ${on.frames} frames`);
expect("the agent's night squat smoke (its own side pockets): no arm over 4 cm into the body, what QA reports is a pocket hand on a frame or two (no WRIST)",
	on.frames === 0 && night.qa.groups.every(g => g.kind === "BODY" && /^hand_[lr] into (thigh_[lr]|hips)$/.test(g.subject) && g.count <= 3 && g.worst <= 0.05), JSON.stringify([on, night.qa.groups.map(g => [g.subject, g.count, g.worst])]));

// 6. the smoking kits (verify-kits.mjs runs them as they were): standing and the two squat sessions, with fix.self
const kc = buildKit("cigarette", [], { position: { x: 0.6, z: 0.5 } }), kl = buildKit("lighter", kc.records, { position: { x: 0.75, z: 0.5 } });
const kscene = motionScene([...kc.records, ...kl.records, { id: "puff", name: "Exhale", renderer: "effect", x: 0, y: 1.5, z: 0.1, rot: 0, footprint: { width: 0, depth: 0 }, height: 0 }]);
const SQUAT = { root: [0, 0.45, -0.12], yaw: 0, pitch: 22, spine_pitch: 10, head_pitch: -12, foot_l: [0.16, 0.101, 0.02], foot_r: [-0.16, 0.101, 0.02], fyaw_l: 15, fyaw_r: -15, knee_l: [0.45, 0, 1], knee_r: [-0.45, 0, 1] };
const smokeWith = start => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: "auto", ...start, use: [...(start.use ?? []), { skill: "smokeCigarette", f0: 1, args: { kit: { cig: kc.rootId, lighter: kl.rootId, exhale: "puff" } } }] });
for (const rig of ["y-bot-tpose", "x-bot-tpose"]) for (const [label, start] of [["standing", { use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } }] }], ["squatting", { keys: [{ f: 0, set: SQUAT }] }]]) {
	const sk = skeletonFor(rig), was = overlap(sk, compileSpec(legacySpec(smokeWith(start)), { sk, scene: kscene }).out, 0.04), r = compileSpec(smokeWith(start), { sk, scene: kscene }), now = overlap(sk, r.out, 0.04);
	const left = r.qa.groups.map(g => `${g.kind} ${g.subject}`);
	console.log(`  kits ${rig} ${label}: arm over 4 cm into the body on ${was.frames} frames (${cm(was.max)} cm) -> ${now.frames} (${cm(now.max)} cm); QA ${r.qa.total} ${JSON.stringify(left)}`);
	// open cases, kept bounded: the Y Bot's forearm over its belly or chest with the cigarette at the lips (standing: the
	// elbow may rise no higher than the skill's chicken-wing check, so the forearm keeps 2-3 cm on the torso), a hand
	// leaving a side pocket for a frame or two and the drags' forearm just past the POP limit (squatting)
	const open = g => (g.kind === "BODY" && /^(farm_r into torso_(lo|hi)|hand_[lr] into thigh_[lr])$/.test(g.subject) && g.worst <= 0.075 && (g.subject.startsWith("farm") || g.count <= 3))
		|| (g.kind === "POP" && g.worst <= 0.056);
	expect(`kits ${rig} ${label}: an arm over 4 cm into the body on <= 3 frames (was ${was.frames}), what QA leaves is the open cases`, was.frames >= 50 && now.frames <= 3 && r.qa.groups.every(open), JSON.stringify(left));
}

if (failures) { console.error(`${failures} self-collision check(s) failed`); process.exit(1); }
console.log("motion3 self: all checks passed");
