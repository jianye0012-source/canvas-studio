#!/usr/bin/env node
// C15 kits (docs/motion-api-v3.1.md, src/kits/): object.createKit builds an Empty root at the grip
// plus parts, as one write, and answers { rootId, parts, bind }; the smoking kits are sized and
// gripped like the smokeCigarette props, so with args.kit the compiled take puts the filter on the
// lips and the flame under the tip (probes, within 1 cm) from standing and from the squats of the
// user's sessions (d51e2c8d: pitch 22, spine 10, head -12; 1f7f8914: squat keyed before f0), with
// QA 0 and the lit parts switched by the skill's channels (ember 0.6 idle, 2 on a drag; exhale).
import { buildKit, KIT_CATALOGUE, KIT_NAMES } from "../../src/kits/index.js";
import { createStudioAppActions } from "../../src/commands/index.js";
import { compileSpec } from "../motion3/fixtures/legacy-compile.mjs";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { objectSize } from "../../src/scene-objects.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}

// 1. every kit builds: the root (an Empty) first, its parts under it, nothing under the floor
let existing = [];
const built = {};
for (const kit of KIT_NAMES) {
	const k = buildKit(kit, existing, { position: { x: existing.length * 0.3, z: 1 } });
	built[kit] = k;
	existing = [...existing, ...k.records];
	const root = k.records[0];
	expect(`${kit}: an Empty root first, every part parented to it, ids unique, y >= 0`, root.renderer === "empty" && root.id === k.rootId
		&& k.records.slice(1).every(r => r.parent === k.rootId) && new Set(existing.map(r => r.id)).size === existing.length && k.records.every(r => r.y >= 0),
	JSON.stringify(k.records.map(r => [r.id, r.renderer, r.parent, r.y])));
	// the exhale kit rides no hand: its root follows the mouth (C16)
	// a pinned grip names along; the ball names a grasp instead and rests where the hand takes it (#816)
	expect(`${kit}: bind carries the root and names a prop (exhale: follows the mouth)`, kit === "exhale" ? k.bind[k.rootId]?.follow === "landmark:mouth" : k.bind[k.rootId]?.prop && (Array.isArray(k.bind[k.rootId].along) || typeof k.bind[k.rootId].grasp === "string"), JSON.stringify(k.bind));
}
const cigBody = built.cigarette.records.find(r => r.id === built.cigarette.parts.body);
expect("the cigarette is 7.8 mm thick, its root at the grip 2.6 cm from the filter end",
	Math.abs(objectSize(cigBody).width - 0.0078) < 1e-4 && Math.abs(built.cigarette.records[0].y - cigBody.y - 0.026) < 1e-4, JSON.stringify([objectSize(cigBody), cigBody.y]));
const batBody = built.bat.records.find(r => r.id === built.bat.parts.body);
expect("the bat is 0.84 m long from the knob at its root, 67 mm across the barrel", Math.abs(objectSize(batBody).height - 0.84) < 1e-3 && Math.abs(objectSize(batBody).width - 0.067) < 1e-3
	&& Math.abs(batBody.y - built.bat.records[0].y) < 1e-6, JSON.stringify(objectSize(batBody)));
expect("an unknown kit is refused with the kit list", /kit "pipe" is not a kit \(kits: cigarette, lighter, exhale, bat, ball, sword, pistol\)/.test(buildKit("pipe").error ?? ""));
expect("the catalogue lists every kit with its parts, prop (exhale: the point it follows) and a one-line description",
	KIT_CATALOGUE.length === KIT_NAMES.length && KIT_CATALOGUE.every(k => k.description.length > 20 && !k.description.includes("\n")
		&& (k.kit === "exhale" ? k.parts.includes("puff") && k.follow === "landmark:mouth" && !k.prop : k.parts.includes("body") && k.prop)), JSON.stringify(KIT_CATALOGUE.find(k => k.kit === "exhale")));

// 2. object.createKit through the action registry: one write, the answer, a refusal
let objects = [], writes = 0;
const store = { read: () => objects, write: next => { writes += 1; objects = next; } };
const ports = { state: () => ({ objects, characters: [], frameCount: 300 }), storeDomain: name => (name === "objects" ? store : null) };
const registry = createStudioAppActions(ports);
const made = registry.run("object.createKit", { kit: "cigarette", name: "Smoke", position: { x: 0.5, z: 0.4 } });
expect("object.createKit writes the whole kit at once and answers rootId, parts and bind", writes === 1 && objects.length === made.affectedIds.length
	&& made.output.rootId === objects[0].id && objects[0].name === "Smoke" && made.output.parts.body && made.output.bind[made.output.rootId].prop === "cig" && !made.output.records,
	JSON.stringify(made));
let refused = null;
try { registry.run("object.createKit", { kit: "pipe" }); } catch (error) { refused = error; }
expect("object.createKit refuses an unknown kit", refused?.code === "INVALID_ARGUMENT", String(refused));

// 3. the smoke take with kits: the ember and the flame glow, the lights and the tip smoke are box-less
//    records (motionScene lists them in others by renderer), the exhale is an effect that follows the mouth (C16).
function smokingScene() {
	const cig = buildKit("cigarette", [], { position: { x: 0.6, z: 0.5 } }), lit = buildKit("lighter", cig.records, { position: { x: 0.75, z: 0.5 } });
	const records = [...cig.records, ...lit.records, { id: "puff", name: "Exhale", renderer: "effect", x: 0, y: 1.5, z: 0.1, rot: 0, footprint: { width: 0, depth: 0 }, height: 0 }];
	return { cig, lit, records };
}
const { cig, lit, records } = smokingScene(), scene = motionScene(records);
expect("the smoking kits have every part: the ember and flame glow, the lights and the tip smoke exist",
	["body", "ember", "light", "smoke"].every(r => cig.parts[r]) && ["body", "flame", "light"].every(r => lit.parts[r]) && !cig.skipped && !lit.skipped
	&& records.find(o => o.id === cig.parts.ember).glow && records.find(o => o.id === lit.parts.light).light?.flicker > 0 && records.find(o => o.id === cig.parts.smoke).effect?.preset === "smoke",
	JSON.stringify([cig.parts, lit.parts]));
const SQUAT = { root: [0, 0.45, -0.12], yaw: 0, pitch: 22, spine_pitch: 10, head_pitch: -12, foot_l: [0.16, 0.101, 0.02], foot_r: [-0.16, 0.101, 0.02], fyaw_l: 15, fyaw_r: -15, knee_l: [0.45, 0, 1], knee_r: [-0.45, 0, 1] };
const SQUAT_DOWN = { root: [0, 0.42, -0.1], pitch: 15, spine_pitch: 20, head_pitch: -20, foot_l: [0.15, 0.101, 0.03], foot_r: [-0.15, 0.101, 0.03], knee_l: [0.45, 0, 1], knee_r: [-0.45, 0, 1] };
const smoke = (start, f0, kit = { cig: cig.rootId, lighter: lit.rootId, exhale: "puff" }) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: "auto", label: "smoke with kits", ...start,
	use: [...(start.use ?? []), { skill: "smokeCigarette", f0, args: kit ? { kit } : {} }] });
const probes = f0 => [
	{ name: "filterToLips", distance: ["landmark:mouth", `object:${cig.parts.body}`], frames: [f0 + 59, f0 + 91] },
	{ name: "filterToLips2", distance: ["landmark:mouth", `object:${cig.parts.body}`], frames: [f0 + 195, f0 + 211] },
	{ name: "flameToTip", distance: [`object:${lit.parts.flame}.top`, "prop:cig.tip"], frames: [f0 + 63, f0 + 78] },
];
// standing on the rig's own ankle height, then squatting down over 32 frames (session 1f7f8914)
const standing = sk => { const P = sk.restWorldPos, I = sk.index, a = P[I.LeftFoot][1];
	return { root: [0, P[I.Hips][1] - 0.01, 0], yaw: 0, foot_l: [0.15, a, 0.03], foot_r: [-0.15, a, 0.03], fyaw_l: 15, fyaw_r: -15 }; };
const CASES = [
	["standing", () => ({ use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } }] }), 1],
	["squatting from f0 (session d51e2c8d)", () => ({ keys: [{ f: 0, set: SQUAT }] }), 1],
	["squatting down before f0 (session 1f7f8914)", sk => ({ keys: [{ f: 0, set: standing(sk) }, { f: 32, set: SQUAT_DOWN }] }), 40],
];
for (const rig of ["y-bot-tpose", "x-bot-tpose"]) for (const [label, startOf, f0] of CASES) {
	const sk = skeletonFor(rig), start = startOf(sk), r = compileSpec(smoke(start, f0), { sk, scene }, { probes: probes(f0) }), p = r.probes, o = r.expanded.objects;
	console.log(`  ${rig} ${label}: QA ${r.qa.total}, filter to lips max ${p.filterToLips.max} / ${p.filterToLips2.max} m, flame top to tip max ${p.flameToTip.max} m`);
	expect(`${rig} ${label}: QA 0 with both kits carried`, r.qa.ok, JSON.stringify(r.qa.groups.slice(0, 3).map(g => [g.kind, g.subject, g.worst, g.first, g.last])));
	expect(`${rig} ${label}: the filter is at the lips (<= 1 cm) on both drags, the flame under the tip (<= 1 cm)`,
		p.filterToLips.max <= 0.01 && p.filterToLips2.max <= 0.01 && p.flameToTip.max <= 0.01, JSON.stringify(p));
	expect(`${rig} ${label}: args.kit adds the carries and the switches`,
		JSON.stringify(o[cig.rootId]) === JSON.stringify({ prop: "cig", grab: f0 + 28, at: [0, 0, 0], along: [0, 0, 1], visible: "cig_vis" })
		&& JSON.stringify(o[lit.rootId]) === JSON.stringify({ prop: "lighter", grab: f0 + 35, release: f0 + 102, at: [0, 0, 0], along: [0, 1, 0], visible: "lit_vis" })
		&& o[cig.parts.ember]?.level === "ember" && o[cig.parts.light]?.level === "ember" && o[cig.parts.smoke]?.visible === "ember_vis"
		&& o[lit.parts.flame]?.visible === "flame_vis" && o[lit.parts.light]?.visible === "flame_vis"
		&& JSON.stringify(o.puff) === JSON.stringify({ follow: "landmark:mouth", aim: "face", visible: "exhale" }), JSON.stringify(o));
	if (rig !== "y-bot-tpose" || f0 !== 1) continue;
	const b = r.out.baked, at = f => f0 + f;
	expect(`${label}: ember 0 before lighting, 2 on each drag, 0.6 between; exhale on while breathing out`,
		b.ember[at(60)] === 0 && Math.abs(b.ember[at(85)] - 2) < 1e-6 && Math.abs(b.ember[at(150)] - 0.6) < 1e-6 && Math.abs(b.ember[at(205)] - 2) < 1e-6
		&& b.exhale[at(110)] === 0 && b.exhale[at(125)] === 1 && b.exhale[at(150)] === 0 && b.exhale[at(250)] === 1, [60, 85, 150, 205].map(f => b.ember[at(f)]).join());
	if (label.startsWith("squatting")) expect(`${label}: the head pitches from its own -12 (to -6 at the lips), not to an absolute 6`,
		Math.abs(r.out.frames[at(70) - r.out.f0].c.head_pitch - -6) < 1e-6, r.out.frames[at(70)].c.head_pitch);
}

// 4. without kits, the user's squat of session d51e2c8d now puts the filter on the lips (it was 18 cm off)
const plain = compileSpec(smoke({ keys: [{ f: 0, set: SQUAT }] }, 1, null), { sk: skeletonFor("y-bot-tpose"), scene: { objects: {} } });
expect("the session's squat (pitch 22, spine 10, head -12) compiles with the filter on the lips, QA 0", plain.qa.ok, JSON.stringify(plain.qa.groups.slice(0, 3).map(g => [g.kind, g.subject])));
const kitRefusal = (() => { try { compileSpec(smoke({ keys: [{ f: 0, set: SQUAT }] }, 1, { cig: "nope", lighter: lit.rootId }), { sk: skeletonFor("y-bot-tpose"), scene }); return ""; } catch (error) { return error.message; } })();
expect("a kit id that is no group is refused by the skill", kitRefusal.includes('use[0] smokeCigarette: args.kit.cig "nope" is not a group in the scene; object.createKit { kit: "cigarette" } answers its rootId'), kitRefusal);

if (failures) { console.error(`${failures} kit check(s) failed`); process.exit(1); }
console.log("kits: all checks passed");
