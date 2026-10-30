#!/usr/bin/env node
// C15 switch entries and levels (docs/motion-api-v3.1.md): spec.objects[id] = { visible?, level? }
// with no prop and no hinge field validates with exact messages, bakes vis/lvl tracks without
// pos/quat, never moves its record (the parent's carry still applies), and shows/hides it in the
// timeline; a carry takes level too. trackLevel reads the lvl track; a hidden group hides its
// parts in trackShown (with the records) and sceneObjectsAt. An object that appears in the hand at
// grab (hidden before) has nothing to pick up: no GRAB issue.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { validateSpec } from "../../src/motion3/compiler/validate.js";
import { bakeTake } from "../../src/motion3/take.js";
import { objectTracksOf } from "../../src/motion3/object-tracks.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { sceneObjectTravelMatrixAt, sceneObjectsAt, trackLevel, trackShown } from "../../src/object-travel.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const refusal = run => { try { run(); return ""; } catch (error) { return error.message; } };

// A box group (Empty "kit" with a body and a glowing bulb) on a table, a lamp light and a smoke
// effect with no box of their own, and a Y Bot at the origin facing +Z.
const rec = (id, renderer, x, y, z, s, extra = {}) => ({ id, name: id, renderer, x, y, z, rot: 0, rotX: 0, rotZ: 0, scaleX: s[0], scaleY: s[1], scaleZ: s[2], footprint: { width: 1, depth: 1 }, height: 1, ...extra });
const RECORDS = [
	rec("kit", "empty", 0.25, 0.9, 0.45, [1, 1, 1], { footprint: { width: 0, depth: 0 }, height: 0 }),
	rec("body", "cube", 0.25, 0.9, 0.45, [0.04, 0.08, 0.04], { parent: "kit" }),
	rec("bulb", "sphere", 0.25, 0.98, 0.45, [0.02, 0.02, 0.02], { parent: "kit", glow: { color: "#ff9a3c", intensity: 4, halo: 1.5 } }),
	rec("smoke", "effect", 0.25, 1, 0.45, [1, 1, 1], { parent: "kit", footprint: { width: 0, depth: 0 }, height: 0 }),
	rec("lamp", "light", -1, 2, 0, [1, 1, 1], { footprint: { width: 0, depth: 0 }, height: 0 }),
];
const sk = skeletonFor("y-bot-tpose"), scene = motionScene(RECORDS);
expect("motionScene lists box-less records in others (renderer, ancestors) and flags a glowing body",
	scene.others.lamp?.renderer === "light" && JSON.stringify(scene.others.smoke?.ancestors) === '["kit"]' && scene.objects.bulb.glow === true && !scene.objects.body.glow && !scene.objects.lamp,
	JSON.stringify(scene.others));

const grip = { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { tip: [0, 0, 0.05] } };
const base = (objects, keys = []) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 60, props: { grip }, objects,
	use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } }], keys });
const plain = (objects, keys) => { const { use: _use, ...rest } = base(objects, keys); return rest; };
const bad = objects => refusal(() => validateSpec(plain(objects), { sk, scene }));

// 1. validation (exact messages)
expect("a switch on a box-less record (a light) and on a body part validates",
	bad({ lamp: { visible: "lamp_vis", level: "lamp" }, bulb: { level: "glow" }, smoke: { visible: "smoke_vis" } }) === "", bad({ lamp: { visible: "lamp_vis" } }));
expect("an empty switch names what it needs",
	bad({ lamp: {} }).includes('objects.lamp needs visible or level (a channel): a switch shows, hides or dims "lamp" without moving it; a carry needs prop, a hinge pivot and channel'), bad({ lamp: {} }));
expect("an unknown switch field says the switch fields",
	bad({ lamp: { visibel: "x" } }).includes('objects.lamp (switch) has unknown field "visibel"; did you mean "visible"?; fields: visible, level'), bad({ lamp: { visibel: "x" } }));
expect("level must name a channel, on a switch and on a carry",
	bad({ lamp: { level: 2 } }).includes("objects.lamp.level must name a channel (the record's level 0..4: 0 dark, 1 as authored; it scales its light, glow and effect rate)")
	&& bad({ kit: { prop: "grip", level: "" } }).includes("objects.kit.level must name a channel"), bad({ lamp: { level: 2 } }));
expect("a switch on an id the scene does not have is refused with a suggestion",
	bad({ lamps: { visible: "v" } }).includes('objects.lamps names object "lamps", which is not in the scene; did you mean "lamp"?'), bad({ lamps: { visible: "v" } }));
expect("a hinge field still makes a hinge (pivot without channel)", bad({ lamp: { pivot: [0, 0, 0] } }).includes("objects.lamp.channel must name the angle channel"), bad({ lamp: { pivot: [0, 0, 0] } }));
expect("visible and level channels need no spec.channels", bad({ lamp: { visible: "lamp_on", level: "lamp_dim" } }) === "" &&
	refusal(() => validateSpec(plain({ lamp: { visible: "lamp_on", level: "lamp_dim" } }, [{ f: 10, set: { lamp_on: 1, lamp_dim: 2.5 } }]), { sk, scene })) === "");

// 2. the take: vis/lvl tracks, no pos/quat for a switch; a carry with level gets lvl
const spec = base({ kit: { prop: "grip", at: [0, 0, 0], along: [0, 1, 0], visible: "kit_vis", level: "kit_lvl" }, bulb: { visible: "bulb_vis", level: "bulb" }, smoke: { visible: "bulb_vis" }, lamp: { level: "lamp" } },
	[{ f: 0, set: { kit_vis: 0, bulb_vis: 0, bulb: 0.5, kit_lvl: 1 } }, { f: 10, set: { kit_vis: 1 }, step: ["kit_vis"] }, { f: 20, set: { bulb_vis: 1, bulb: 0.5 }, step: ["bulb_vis"] },
		{ f: 30, set: { bulb: 2 } }, { f: 50, set: { kit_vis: 0, bulb_vis: 0 }, step: ["kit_vis", "bulb_vis"] }]);
const r = compileSpec(spec, { sk, scene });
expect("the switch spec compiles clean", r.qa.ok, JSON.stringify(r.qa.groups.slice(0, 2)));
const take = bakeTake(sk, r.out), T = take.objects;
expect("switch tracks carry vis/lvl and no pos/quat; the carry keeps pos/quat/hold and gains vis/lvl",
	!T.bulb.pos && !T.bulb.quat && T.bulb.vis instanceof Uint8Array && T.bulb.lvl instanceof Float32Array && !T.smoke.lvl && T.smoke.vis && !T.lamp.vis && T.lamp.lvl
	&& T.kit.pos && T.kit.quat && T.kit.hold && T.kit.vis && T.kit.lvl, JSON.stringify(Object.fromEntries(Object.entries(T).map(([k, v]) => [k, Object.keys(v)]))));
expect("lvl is the channel value (clamped 0..4); an unkeyed level channel reads 1",
	Math.abs(T.bulb.lvl[20] - 0.5) < 1e-6 && Math.abs(T.bulb.lvl[30] - 2) < 1e-6 && T.lamp.lvl.every(v => v === 1), `${T.bulb.lvl[20]} ${T.bulb.lvl[30]} ${T.lamp.lvl[0]}`);
expect("vis follows its channel above 0.5", T.bulb.vis[19] === 0 && T.bulb.vis[20] === 1 && T.bulb.vis[50] === 0 && T.kit.vis[10] === 1);
const events = r.timeline.flatMap(b => b.events).map(e => `${e.f} ${e.object} ${e.event}`);
expect("the timeline shows and hides every object a channel switches (bulb and smoke on bulb_vis)",
	["10 kit show", "20 bulb show", "20 smoke show", "50 bulb hide", "50 smoke hide", "50 kit hide"].every(e => events.includes(e)), JSON.stringify(events));

// 3. object-travel: a switch track is no motion of its own; levels; inherited visibility
const tracks = objectTracksOf({ motionFor: () => take }, [{ id: "c" }]), tk = { frameCount: 60, fps: 24, objectTracks: tracks };
const lookup = new Map(RECORDS.map(o => [o.id, o]));
const kitAt = sceneObjectTravelMatrixAt(lookup, "kit", 30, tk), bulbAt = sceneObjectTravelMatrixAt(lookup, "bulb", 30, tk);
const restOffset = [RECORDS[2].x - RECORDS[0].x, RECORDS[2].y - RECORDS[0].y, RECORDS[2].z - RECORDS[0].z];
const e = bulbAt.elements, k = kitAt.elements, moved = [e[12] - k[12], e[13] - k[13], e[14] - k[14]];
expect("a part with only a switch track still rides its carried group (offset from the root kept)",
	Math.hypot(...moved) - Math.hypot(...restOffset) < 1e-4 && Math.hypot(e[12] - RECORDS[2].x, e[13] - RECORDS[2].y, e[14] - RECORDS[2].z) > 0.05, JSON.stringify({ moved, restOffset }));
expect("trackLevel: the lvl value at the frame, 1 without a track", Math.abs(trackLevel("bulb", 30, tk) - 2) < 1e-6 && trackLevel("body", 30, tk) === 1 && trackLevel("bulb", 30, {}) === 1);
expect("trackShown: own track only without records; a hidden group hides its parts with them",
	trackShown("body", 5, tk) === true && trackShown("body", 5, tk, RECORDS) === false && trackShown("body", 15, tk, lookup) === true
	&& trackShown("bulb", 15, tk, lookup) === false && trackShown("bulb", 25, tk, lookup) === true);
const at5 = sceneObjectsAt(RECORDS, 5, tk), at25 = sceneObjectsAt(RECORDS, 25, tk);
expect("sceneObjectsAt hides the parts of a hidden group and shows them when it shows",
	["kit", "body", "bulb", "smoke"].every(id => at5.find(o => o.id === id).hidden === true) && ["kit", "body", "bulb", "smoke"].every(id => !at25.find(o => o.id === id).hidden)
	&& !at5.find(o => o.id === "lamp").hidden, JSON.stringify(at5.map(o => [o.id, o.hidden])));
expect("sceneObjectsAt places a switch-only part by its group's carry", Math.abs(at25.find(o => o.id === "bulb").x - sceneObjectTravelMatrixAt(lookup, "bulb", 25, tk).elements[12]) < 1e-6);

// 4. GRAB: an object that appears in the hand at grab (hidden before) is not picked up from the scene
const appear = (visibleBefore) => compileSpec(base({ kit: { prop: "grip", grab: 20, at: [0, 0, 0], along: [0, 1, 0], visible: "kit_vis" } },
	[{ f: 0, set: { kit_vis: visibleBefore ? 1 : 0 } }, { f: 20, set: { kit_vis: 1 }, step: ["kit_vis"] }]), { sk, scene }).qa.groups.filter(g => g.kind === "GRAB");
expect("an object shown before grab far from the hand is a GRAB issue; one that appears at grab is not", appear(true).length === 1 && appear(false).length === 0,
	JSON.stringify([appear(true).map(g => g.subject), appear(false).map(g => g.subject)]));

if (failures) { console.error(`${failures} motion3 switch check(s) failed`); process.exit(1); }
console.log("motion3 switch entries: all checks passed");
