import assert from "node:assert/strict";
import * as THREE from "three";
import { SUPPORT_SITES, copyPhysicsKeys, physicsKeyStamp, supportIntervals, physicsMetrics } from "../../src/motion/physics-review.js";

// Contact measurement used by motion verification. The AutoPhysics review
// pass that used to share this file was removed with ARDY.
const rows = Array.from({ length: 30 }, (_, f) => ({ support: Object.fromEntries(SUPPORT_SITES.map((s) => [s.id, { floor: s.kind === "foot" ? 0 : 1, position: new THREE.Vector3(f < 12 ? 0 : (f - 11) * .02, .05, 0) }])) }));
let contacts = supportIntervals(rows, 30, [{ site: "leftHand", start: 15, end: 17, mode: "plant" }, { site: "leftKnee", start: 10, end: 12, mode: "plant" }, { site: "leftFoot", start: 0, end: 29, mode: "free" }]);
assert.equal(contacts.masks[0].has("leftFoot"), false);
assert(contacts.masks[16].has("leftHand")); assert(contacts.masks[11].has("leftKnee"));
assert(!contacts.masks[20].has("rightFoot"), "moving low feet are not contacts");
console.log("PASS hand/knee contact overrides, free intervals, and moving-foot detection");
{
	const toeRows = (toeAt, ankleAt = () => 0) => Array.from({ length: 60 }, (_, f) => ({ root: new THREE.Vector3(), support: { leftFoot: { floor: 0, position: new THREE.Vector3(ankleAt(f), .05, 0) } }, toes: { leftFoot: new THREE.Vector3(toeAt(f), .05, 0) }, knees: { leftFoot: 0, rightFoot: 0 } }));
	const moving = supportIntervals(toeRows((f) => f * .005), 30);
	assert(moving.rejected.some((s) => s.site === "leftFoot" && s.reason === "moving-contact"));
	const ankleDrift = supportIntervals(toeRows(() => 0, (f) => f * .005), 30);
	assert(ankleDrift.spans.some((s) => s.site === "leftFoot"));
	const mask = Array.from({ length: 60 }, () => new Map([["leftFoot", ankleDrift.spans[0]]]));;
	const metrics = physicsMetrics(toeRows(() => .031), mask, 30);
	assert(Math.abs(metrics.slide - .031) < 1e-9, "foot slide is measured from toe");
	console.log("PASS foot contacts, wander, and slide use toe positions");
}
{
	const boxRows = Array.from({ length: 12 }, () => ({ root: new THREE.Vector3(), support: { leftFoot: { floor: .2, position: new THREE.Vector3(0, .2, 0) } }, toes: { leftFoot: new THREE.Vector3(0, .2, 0) }, ground: { leftFoot: .2 }, knees: { leftFoot: 0, rightFoot: 0 } }));
	const boxContacts = supportIntervals(boxRows, 30);
	const boxSpan = boxContacts.spans.find((s) => s.site === "leftFoot");
	assert(boxSpan && Math.abs(boxSpan.anchor.y - .2) < 1e-9, "box top is used for the foot span anchor");
	assert.equal(physicsMetrics(boxRows, boxContacts.masks, 30).penetration, 0, "box contact has no penetration");
	console.log("PASS a character standing on a box uses the box top anchor and has zero penetration");
}
{
	const keys = new Map([[0, new Map([["leftFoot", { q: [new THREE.Quaternion()], p: null, baseQ: [new THREE.Quaternion()], chainP: [new THREE.Vector3(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 2, 0)], keepTranslations: true }]])]]);
	const clone = copyPhysicsKeys(keys), key = clone.get(0).get("leftFoot");
	assert(key.keepTranslations); assert(key.chainP); key.baseQ[0].x += .1; key.chainP[1].y += 1;
	assert.notEqual(physicsKeyStamp(clone), physicsKeyStamp(keys));
	assert.notEqual(key.chainP[1].y, keys.get(0).get("leftFoot").chainP[1].y);
	console.log("PASS undo copies preserve correction metadata without sharing references");
}
console.log("all pass");
