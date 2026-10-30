#!/usr/bin/env node
// Object anchors on a carried object (session 68d305dc: the left hand on the handguard of a rifle the
// right hand carried read the rifle's scene spot on the floor, REACH 2.43 m, and the hint told the
// agent to move the anchor there). An object anchor now reads the object where refs, probes and QA
// read it (object-pose.js objectPoseAt): a carried part or group where it rides, a hinged one turned,
// the scene pose before grab. The carrying hand's own anchor stays where it took it; the right hand
// cannot follow what the left carries (the right arm is solved first); a group id is an anchor too;
// an object anchor's hint moves its local point, never the object.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { refPoint } from "../../src/motion3/refs.js";
import { objectBoxesAt, rootPoseAt } from "../../src/motion3/object-pose.js";
import { add, apply, dist } from "../../src/motion3/compiler/math.js";
import { applyPatch } from "../../src/motion3/json-patch.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const refusal = run => { try { run(); return ""; } catch (error) { return error.message; } };

const rec = (id, renderer, x, y, z, s, extra = {}) => ({ id, name: id, renderer, x, y, z, rot: 0, rotX: 0, rotZ: 0, scaleX: s[0], scaleY: s[1], scaleZ: s[2], footprint: { width: 1, depth: 1 }, height: 1, ...extra });
// A two-part gun (an Empty with a handguard and a stock) lying on the floor to the character's right,
// a cup on a shelf in the right hand's reach and a post far away.
const RECORDS = [
	rec("gun", "empty", -0.6, 0, 0.5, [1, 1, 1], { footprint: { width: 0, depth: 0 }, height: 0 }),
	rec("guard", "cube", -0.6, 0, 0.3, [0.05, 0.06, 0.25], { parent: "gun" }),
	rec("stock", "cube", -0.6, 0, 0.7, [0.05, 0.06, 0.25], { parent: "gun" }),
	rec("cup", "cube", -0.22, 1.05, 0.25, [0.06, 0.1, 0.06]),
	rec("post", "cube", 3, 0, 3, [0.1, 1.2, 0.1]),
];
const sk = skeletonFor("y-bot-tpose"), scene = motionScene(RECORDS), LOCAL = [0, 0.03, 0];
const base = (extra = {}) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 30,
	props: { grip: { hand: "r", origin: ["RightHandIndex1", "RightHandMiddle1"], points: { tip: [0, 0, 0] } } },
	anchors: { lHold: { kind: "object", object: "guard", local: LOCAL }, rLow: { kind: "body", p: [-0.1, 0.2, 0.3] }, rHigh: { kind: "body", p: [-0.1, 0.32, 0.3] } },
	objects: { gun: { prop: "grip", at: [0.04, 0.08, 0.02], along: [0, 1, 0] } },
	keys: [{ f: 0, set: { root: [0, 0.98, 0], armw_r: 1, armw_l: 1, w_rLow_r: 1, w_rHigh_r: 0, w_lHold_l: 1, fingers_r: { grip: 1 }, fingers_l: { grip: 1 } } },
		{ f: 29, set: { w_rLow_r: 0, w_rHigh_r: 1 } }],
	...extra });
const point = (pose, local) => add(pose.pos, apply(pose.R, local));
const frames = out => Array.from({ length: out.frames.length }, (_, i) => i + (out.f0 ?? 0));
const worst = (out, fn) => Math.max(...frames(out).map(fn));

// The right hand carries the gun from frame 0 and lifts it; the left hand holds the handguard.
const held = compileSpec(base(), { sk, scene }), out = held.out;
const guardAt = f => point(objectBoxesAt(out, "guard", f)[0], LOCAL);
expect("the left hand on a part of the carried gun reaches it: no REACH", !held.qa.groups.some(g => g.kind === "REACH"), JSON.stringify(held.qa.groups.filter(g => g.kind === "REACH").map(g => g.hint)));
expect("anchor:lHold is the handguard point where QA and probes see it, every frame (< 1 mm)", worst(out, f => dist(refPoint(out, f, "anchor:lHold"), guardAt(f))) < 1e-3, worst(out, f => dist(refPoint(out, f, "anchor:lHold"), guardAt(f))));
expect("the left wrist is on that point every frame (< 1 cm)", worst(out, f => dist(refPoint(out, f, "joint:LeftHand"), guardAt(f))) < 0.01, worst(out, f => dist(refPoint(out, f, "joint:LeftHand"), guardAt(f))));
expect("the gun rides the right hand: the handguard rises with it", guardAt(29)[1] - guardAt(0)[1] > 0.05 && guardAt(0)[1] > 0.5, `${guardAt(0)} -> ${guardAt(29)}`);

// lHold.local is inside the handguard: the left arm in the carried gun. Moving the carrying hand cannot part
// them (the left hand rides the gun), so the hint and its patch move lHold's local point out of the gun.
const arm = r => r.qa.groups.filter(x => /^(hand|farm)_l x gun$/.test(x.subject)), hit = arm(held)[0];
expect("the left arm in the carried gun: the hint moves anchors.lHold.local out, the gun stays", /^anchors\.lHold\.local \(a point on guard, in guard's axes; guard stays\): move \[.*\] m at f\d+ \(out of gun\)$/.test(hit?.hint ?? "")
	&& hit.patch?.length === 1 && hit.patch[0].path === "/anchors/lHold/local", JSON.stringify(arm(held).map(x => [x.hint, x.patch])));
const moved = compileSpec(applyPatch(base(), hit.patch), { sk, scene }), after = arm(moved).find(x => x.subject === hit.subject);
expect("applying that patch takes the arm out of the gun (or less deep)", !after || after.worst < hit.worst - 0.005, `${hit.subject} ${hit.worst} -> ${after?.worst}`);

// A group id is an anchor too: local in the group's own axes, from its origin.
const group = compileSpec(base({ anchors: { ...base().anchors, lHold: { kind: "object", object: "gun", local: [0, 0.03, 0.2] } } }), { sk, scene });
const groupAt = f => point(rootPoseAt(group.out, "gun", f), [0, 0.03, 0.2]);
expect("a group anchor validates and reads the carried group's pose (< 1 mm)", worst(group.out, f => dist(refPoint(group.out, f, "anchor:lHold"), groupAt(f))) < 1e-3, JSON.stringify(group.qa.groups.slice(0, 2)));

// Grabbed at f15 (no at/along: it keeps the grab-frame offset): before grab the scene pose, then the hand.
const grabbed = compileSpec(base({ objects: { gun: { prop: "grip", grab: 15 } } }), { sk, scene }), g = grabbed.out;
const rest = point(scene.objects.guard, LOCAL);
expect("before grab the anchor is the handguard's scene point", [0, 7, 14].every(f => dist(refPoint(g, f, "anchor:lHold"), rest) < 1e-9), refPoint(g, 0, "anchor:lHold"));
expect("from grab on it follows the carried handguard (< 1 mm)", [15, 22, 29].every(f => dist(refPoint(g, f, "anchor:lHold"), point(objectBoxesAt(g, "guard", f)[0], LOCAL)) < 1e-3));

// The carrying hand's own anchor on what it carries stays where it took it (its target cannot ride on itself).
const own = compileSpec(base({ anchors: { ...base().anchors, rCup: { kind: "object", object: "cup", local: [0, 0.05, 0] } }, objects: { cup: { prop: "grip", grab: 15 } },
	keys: [{ f: 0, set: { root: [0, 0.98, 0], armw_r: 1, w_rCup_r: 1, armw_l: 0 } }] }), { sk, scene }).out;
const cupRest = point(scene.objects.cup, [0, 0.05, 0]);
expect("the carrying hand keeps aiming where it took the object, after grab too", [10, 20, 29].every(f => dist(refPoint(own, f, "joint:RightHand"), cupRest) < 0.01), refPoint(own, 29, "joint:RightHand"));

// The right arm is solved before the left: the right hand cannot follow what the left carries.
const leftCarry = base({ props: { grip: { hand: "l", origin: ["LeftHandIndex1", "LeftHandMiddle1"], points: { tip: [0, 0, 0] } } },
	anchors: { ...base().anchors, rGuard: { kind: "object", object: "guard", local: LOCAL } },
	keys: [{ f: 0, set: { root: [0, 0.98, 0], armw_l: 1, armw_r: 1, w_rGuard_r: 1, w_lHold_l: 0 } }] });
const refused = refusal(() => compileSpec(leftCarry, { sk, scene }));
expect("a right-hand anchor on what the left hand carries is refused with what to do", /^MOTION_SPEC_INVALID: anchor "rGuard" is on "guard", which the left hand holds at f0; the right arm is solved before the left/.test(refused) && /Carry "guard" in the right hand/.test(refused), refused);

// A hinged object: the anchor turns with it, as before (the same pose QA reads).
const door = compileSpec(base({ anchors: { ...base().anchors, knob: { kind: "object", object: "post", local: [0, 1, 0] } }, objects: { post: { pivot: [3, 0, 2.95], axis: [0, 1, 0], channel: "door" } },
	keys: [{ f: 0, set: { root: [0, 0.98, 0], door: 0 } }, { f: 29, set: { door: 60 } }] }), { sk, scene }).out;
expect("a hinged object's anchor turns with it (< 1 mm)", [0, 15, 29].every(f => dist(refPoint(door, f, "anchor:knob"), point(objectBoxesAt(door, "post", f)[0], [0, 1, 0])) < 1e-3)
	&& dist(refPoint(door, 0, "anchor:knob"), refPoint(door, 29, "anchor:knob")) > 0.01);

// Out of reach on a still object: the hint moves the anchor's local point, never the object.
const far = compileSpec(base({ anchors: { ...base().anchors, far: { kind: "object", object: "post", local: [0, 1, 0] } }, objects: {},
	keys: [{ f: 0, set: { root: [0, 0.98, 0], armw_l: 1, w_far_l: 1 } }] }), { sk, scene });
const reach = far.qa.groups.find(x => x.kind === "REACH" && x.subject === "arm_miss_l");
expect("REACH on an object anchor names anchors.far.local and says the object stays", /anchors\.far\.local \(a point on post, in post's axes; post stays\): move \[/.test(reach?.hint ?? "") && !/anchor far: move/.test(reach.hint), reach?.hint);

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("PASS carried-object anchors");
