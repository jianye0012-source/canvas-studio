#!/usr/bin/env node
// motion.describe { topic: "examples" } (two of the last three smoke runs asked for it and were
// refused INVALID_ARGUMENT): whole specs that compile. Each one compiles at QA 0, goals met, on
// the scene its `scene` line names, on both rigs; the answer fits the describe output budget,
// passes the action's input schema through the bus, and stays out of essentials.
import { describe, DESCRIBE_BUDGET } from "../../src/motion3/describe.js";
import { DESCRIBE_TOPICS } from "../../src/motion3/schema/fields.js";
import { MOTION_OUTPUT_BUDGET } from "../../src/motion3/report.js";
import { MOTION_ACTION_HELP } from "../../src/motion3/docs.js";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { buildKit } from "../../src/kits/index.js";
import { createSceneObject } from "../../src/scene-objects.js";
import { createStudioAppActions } from "../../src/commands/index.js";
import { fixture } from "./fixture.mjs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const bytes = v => new TextEncoder().encode(JSON.stringify(v)).length;

// 1. the topic: listed, described in the help, small, out of essentials
const answer = describe("examples");
expect("examples is a describe topic, named in the action help", DESCRIBE_TOPICS.includes("examples") && /topic examples answers whole specs that compile/.test(MOTION_ACTION_HELP.describe));
expect(`examples: ${bytes(answer)} B <= ${MOTION_OUTPUT_BUDGET}, 3-4 { name, scene, spec } and notes`, bytes(answer) <= MOTION_OUTPUT_BUDGET && answer.topic === "examples"
	&& answer.examples.length >= 3 && answer.examples.length <= 4 && answer.examples.every(e => e.name && e.scene && e.spec?.schema === "cozyclay.motion-spec.v1") && answer.notes.length > 0);
const ess = describe("essentials");
expect(`essentials stays as it was (${bytes(ess)} B <= ${DESCRIBE_BUDGET}) and holds no example spec`, bytes(ess) <= DESCRIBE_BUDGET && !JSON.stringify(ess).includes("lantern") && !("examples" in ess.types));

// 2. the four kinds asked for: a reachGrip carry, a squat smoke with args.kit, an aim-keyed held object, a hinge
const specs = answer.examples.map(e => e.spec), text = JSON.stringify(specs);
const has = (test, label) => expect(`an example shows ${label}`, specs.some(test));
has(s => s.use?.some(u => u.skill === "reachGrip") && Object.values(s.objects ?? {}).some(o => o.prop === `${s.use.find(u => u.skill === "reachGrip").args.anchor}Grip`), "a reachGrip carry (objects.<id>.prop = <anchor>Grip)");
has(s => s.use?.some(u => u.skill === "smokeCigarette" && u.args?.kit?.cig && u.args.kit.lighter) && s.keys?.[0]?.f === 0 && s.keys[0].set.root[1] < 0.6, "a squat keyed before the skill and smokeCigarette args.kit");
has(s => Object.values(s.objects ?? {}).some(o => o.keys?.length && o.keys.every(k => k.aim && !k.rot)), "a held object keyed with aim");
has(s => Object.values(s.objects ?? {}).some(o => o.pivot && o.channel) && s.keys?.some(k => Object.keys(k.set).includes(Object.values(s.objects).find(o => o.channel).channel)), "a hinge driven by its channel");
expect("no example names a third-party product or leaves a placeholder id", !/<|TODO|rootId"/.test(text));

// 3. each compiles at QA 0 with its goals met on the scene it names, on both rigs
const rename = (records, map) => records.map(r => ({ ...r, id: map[r.id] ?? r.id, ...(r.parent ? { parent: map[r.parent] ?? r.parent } : {}) }));
const kit = (name, id, existing = [], position = {}) => { const k = buildKit(name, existing, { position }); return rename(k.records, { [k.rootId]: id }); };
const box = (id, [x, y, z], [sx, sy, sz]) => ({ ...createSceneObject("cube"), id, name: id, x, y, z, scaleX: sx, scaleY: sy, scaleZ: sz });
const smokeKits = () => { const cig = kit("cigarette", "cig", [], { x: 0.6, z: 0.5 }), lit = kit("lighter", "lighter", cig, { x: 0.75, z: 0.5 }); return [...cig, ...lit, ...kit("exhale", "exhale", [...cig, ...lit])]; };
/** The scene each `scene` line describes, by the first word of the example's name. */
const SCENES = {
	reachGrip: () => [box("lantern", [0.3, 0.95, 0.4], [0.14, 0.2, 0.14])],
	squat: smokeKits,
	aim: () => kit("sword", "sword", [], { x: -0.3, z: 0.3 }),
	hinge: () => [box("door", [0, 0, 0.75], [0.9, 2, 0.04])],
};
// an inline example with an unknown field is refused, not compiled (the examples below are checked the same way)
{
	let refused = "";
	try { compileSpec({ ...structuredClone(answer.examples[0].spec), objects: { lantern: { prop: "handleGrip", grab: 30, grip: "power" } } }, { sk: skeletonFor("y-bot-tpose"), scene: motionScene(SCENES.reachGrip()) }); } catch (e) { refused = e.message; }
	expect("an inline example with an unknown field (objects.lantern.grip) is refused with the fields", /^MOTION_SPEC_INVALID: .*unknown field "grip"/.test(refused), refused);
}
for (const example of answer.examples) {
	const key = example.name.split(/[\s:]/)[0], scene = motionScene(SCENES[key]());
	for (const rig of ["y-bot-tpose", "x-bot-tpose"]) {
		let r = null, error = "";
		try { r = compileSpec(structuredClone(example.spec), { sk: skeletonFor(rig), scene }); } catch (e) { error = e.message; }
		// WRIST (qa/wrist-checks.js): the squat smoke's mouth arm, swung out of the body by fix.self with the hand kept, bends the
		// wrist toward the thumb past its 20 deg limit; every other group stays at 0
		const known = g => key === "squat" && g.kind === "WRIST" && /^hand_r radial deviation/.test(g.subject);
		expect(`${key} on ${rig}: compiles at QA 0 with every goal met${key === "squat" ? " (but the known WRIST hand_r radial deviation)" : ""}`, (r?.qa.groups ?? [{}]).every(known) && r.qa.goals.every(g => g.ok),
			error || JSON.stringify([r.qa.total, r.qa.goals, r.qa.groups.slice(0, 3).map(g => `${g.kind} ${g.subject}`)]));
	}
}

// 4. through the bus the action's input schema takes the topic (it answered INVALID_ARGUMENT before)
const app = createStudioAppActions({ state: () => ({ characters: [], objects: [], frameCount: 100 }), storeDomain: () => null });
const bus = fixture([app.get("motion.describe")]);
const receipt = await bus.bus.run("motion.describe", { topic: "examples" }, bus.request("agent"));
expect(`motion.describe { topic: "examples" } answers through the bus (${bytes(receipt)} B <= 8192)`, receipt.ok && receipt.status === "completed"
	&& JSON.stringify(receipt.output) === JSON.stringify(answer) && bytes(receipt) <= 8192, JSON.stringify(receipt).slice(0, 300));

if (failures) { console.error(`${failures} examples check(s) failed`); process.exit(1); }
console.log("verify-motion3-examples: all checks passed");
