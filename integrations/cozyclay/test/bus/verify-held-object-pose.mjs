#!/usr/bin/env node
// Held-object gizmo math (src/held-object-pose.js, src/object-gizmo-parts.js): the gizmo stands
// on the pose a take draws (a bat lying in a hand, the parts of a carried group), and a drag moves
// the track root about that centre. A bat is an upright cylinder record (base pivot, +Y its length)
// that the take lays along world +X.
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { dragTravel, dragTurn, drawnPose, editKindAt, hingedRootPose, keyObjectArgs, movedRootPose, rootTrackPose, tipTrail, trackedMoverOf, withPreview } from "../../src/held-object-pose.js";
import { gizmoOrigin, gizmoTurn } from "../../src/object-gizmo-parts.js";

const near = (a, b, eps = 1e-5, what = "") => {
	assert.equal(a.length, b.length, what);
	a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= eps, `${what}: [${a.map((x) => x.toFixed(5))}] vs [${b.map((x) => x.toFixed(5))}]`));
};
const F = 6;
/** A track holding `pos`/`quat` on every frame, in hand on frames 1..4 (or no hold flags: a hinge). */
function track(pos, quat, { hinge = false, characterId = "char-a" } = {}) {
	const t = { frameCount: F, characterId, pos: new Float32Array(F * 3), quat: new Float32Array(F * 4) };
	for (let f = 0; f < F; f += 1) {
		t.pos.set(pos, f * 3);
		t.quat.set(quat, f * 4);
	}
	if (!hinge) t.hold = Uint8Array.from({ length: F }, (_, f) => (f >= 1 && f <= 4 ? 1 : 0));
	return t;
}
const record = (id, extra = {}) => ({ id, name: id, renderer: "cube", x: 0, y: 0, z: 0, rot: 0, rotX: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, height: 1, footprint: { width: 1, depth: 1 }, ...extra });
const lying = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(1, 0, 0)).toArray();
const grip = [0.3, 1.2, 0.5];

// A bat body with its own track, a cup group (Empty root tracked, a body part under it), a
// routed box and an attached prop.
const objects = [
	record("bat", { renderer: "cylinder", x: 2, y: 0, z: 2, scaleX: 0.06, scaleY: 0.84, scaleZ: 0.06 }),
	record("cup", { renderer: "empty", x: 1, y: 0.75, z: 1 }),
	record("cup-body", { renderer: "cylinder", parent: "cup", x: 1, y: 0.75, z: 1, scaleX: 0.08, scaleY: 0.1, scaleZ: 0.08 }),
	record("stuck", { attach: { characterId: "char-a", bone: "RightHand" } }),
	record("plain"),
];
const lookup = new Map(objects.map((o) => [o.id, o]));
const tracks = new Map([["bat", track(grip, lying)], ["cup", track([0.4, 1.1, 0.6], [0, 0, 0, 1])], ["door", track([0, 0, 0], [0, 0, 0, 1], { hinge: true })]]);
const take = { frameCount: F, fps: 24, objectTracks: tracks };

// The take track that draws a record: its own, its group root's, none.
assert.equal(trackedMoverOf(lookup, tracks, "bat").id, "bat");
assert.equal(trackedMoverOf(lookup, tracks, "cup-body").id, "cup", "a part is moved by its carried group root");
assert.equal(trackedMoverOf(lookup, tracks, "plain"), null);
assert.equal(trackedMoverOf(lookup, tracks, "stuck"), null, "a bone-attached record is not take-drawn");
assert.equal(trackedMoverOf(lookup, tracks, "nope"), null);

// What a drag writes at a frame.
assert.equal(editKindAt(tracks.get("bat"), 2), "held");
assert.equal(editKindAt(tracks.get("bat"), 0), null, "before the grab: the plain placement drag");
assert.equal(editKindAt(tracks.get("bat"), 5), null, "after the release: the plain placement drag");
assert.equal(editKindAt(tracks.get("bat"), 99), null, "frames clamp to the take");
assert.equal(editKindAt(tracks.get("door"), 3), "hinge");
assert.equal(editKindAt(null, 3), null);

// (a) The gizmo stands on the drawn bat, not on the record: half its length along its own +Y
// (now world +X) from the grip, turned with it.
const bat = drawnPose(lookup, "bat", 2, take);
near(bat.centre, [grip[0] + 0.42, grip[1], grip[2]], 1e-5, "bat centre");
near(bat.quat, lying, 1e-6, "bat rotation");
const authored = { x: 2, y: 0, z: 2 };
assert.ok(Math.hypot(bat.centre[0] - authored.x, bat.centre[2] - authored.z) > 1, "the drawn centre is away from the authored record");
// The old placement (record x, y + h/2, z on the drawn record) was 0.42 m above the grip.
near(gizmoOrigin({ x: grip[0], y: grip[1], z: grip[2], height: 1, scaleY: 0.84 }, null, new Vector3()).toArray(), [grip[0], grip[1] + 0.42, grip[2]], 1e-9, "authored placement");
near(gizmoOrigin({ x: 9, y: 9, z: 9 }, { pose: bat }, new Vector3()).toArray(), bat.centre, 1e-9, "held placement");
assert.equal(gizmoTurn({ pose: bat, editable: true }, "rotate"), bat.quat, "the rings face the object's own axes while a held drag edits it");
assert.equal(gizmoTurn({ pose: bat, editable: true }, "move"), null, "move arrows stay world");
assert.equal(gizmoTurn({ pose: bat, editable: false }, "rotate"), null, "a plain drag keeps world rings");

// A part of a carried group: the group root's track moves it rigidly from where it was authored.
const part = drawnPose(lookup, "cup-body", 2, take);
near(part.centre, [0.4, 1.1 + 0.05, 0.6], 1e-5, "cup body centre rides the group root");
const marker = drawnPose(lookup, "cup", 2, take);
near(marker.centre, [0.4, 1.1, 0.6], 1e-6, "an Empty's centre is its origin");
assert.equal(drawnPose(lookup, "plain", 2, take), null, "nothing draws it: the authored record is the pose");

// (b) A drag moves the track root about the gizmo centre.
const root = rootTrackPose(tracks.get("bat"), 2);
near(root.pos.toArray(), grip, 1e-6, "root pose from the track");
const spun = movedRootPose(root, bat.centre, { axis: new Vector3(0, 0, 1), degrees: 90 });
// Turned 90 deg about +Z through the centre: the bat now points up, still centred where it was.
const spunTracks = withPreview(tracks, { id: "bat", frame: 2, ...spun });
const spunBat = drawnPose(lookup, "bat", 2, { ...take, objectTracks: spunTracks });
near(spunBat.centre, bat.centre, 1e-5, "a turn keeps the centre where the gizmo stands");
near(new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...spunBat.quat)).toArray(), [0, 1, 0], 1e-5, "the bat's length now points up");
near(spun.pos.toArray(), [bat.centre[0], bat.centre[1] - 0.42, bat.centre[2]], 1e-5, "the root swings round the centre");
const moved = movedRootPose(root, bat.centre, { travel: new Vector3(0, 0.1, -0.2) });
near(moved.pos.toArray(), [grip[0], grip[1] + 0.1, grip[2] - 0.2], 1e-6, "a move translates the root");
near(moved.quat.toArray(), lying, 1e-6, "a move keeps the rotation");
// A group root moved through one of its parts: the part's centre moves exactly with the drag.
const cupRoot = rootTrackPose(tracks.get("cup"), 2);
const cupSpun = movedRootPose(cupRoot, part.centre, { axis: new Vector3(1, 0, 0), degrees: 45 });
const cupAfter = drawnPose(lookup, "cup-body", 2, { ...take, objectTracks: withPreview(tracks, { id: "cup", frame: 2, ...cupSpun }) });
near(cupAfter.centre, part.centre, 1e-5, "a group part keeps its centre when its root turns about it");

// The preview replaces one frame of one track and never touches the source.
assert.equal(withPreview(tracks, null), tracks);
assert.equal(withPreview(tracks, { id: "missing", frame: 2, ...moved }), tracks);
near(Array.from(spunTracks.get("bat").pos.subarray(3, 6)), grip, 1e-6, "other frames are untouched");
near(Array.from(tracks.get("bat").pos.subarray(6, 9)), grip, 1e-6, "the source track is untouched");
assert.equal(spunTracks.get("bat").hold, tracks.get("bat").hold, "hold flags carry over");

// Snapping: an arrow reads one axis, a plane two, each to the 5 cm grid; rings to 5 degrees.
const x = new Vector3(1, 0, 0), z = new Vector3(0, 0, 1);
near(dragTravel(new Vector3(0.12, 0.3, -0.07), [x], 0.05).toArray(), [0.1, 0, 0], 1e-9, "arrow travel");
near(dragTravel(new Vector3(0.12, 0.3, -0.07), [x, z], 0.05).toArray(), [0.1, 0, -0.05], 1e-9, "plane travel");
near(dragTravel(new Vector3(0.12, 0.3, -0.07), [x, z]).toArray(), [0.12, 0, -0.07], 1e-9, "unsnapped travel");
assert.equal(dragTurn(33, 5), 35);
assert.equal(dragTurn(33.3), 33.3);

// The action arguments: world metres and a unit quaternion [x, y, z, w], at an integer frame.
const args = keyObjectArgs("char-a", "bat", 2.4, { pos: new Vector3(0.123456, 1, -0.5), quat: new Quaternion(0, 0, 2, 2) });
assert.deepEqual(args, { characterId: "char-a", objectId: "bat", frame: 2, pos: [0.1235, 1, -0.5], rot: [0, 0, 0.7071, 0.7071] });

// A hinge drag keeps only the turn about the hinge axis, about the hinge pivot, and keys the
// rotation alone (the engine projects it onto the axis, C14).
const doorRoot = { pos: new Vector3(1.5, 0, 0), quat: new Quaternion() };
const hinge = { pivot: [1.5, 0, 0.45], axis: [0, 1, 0] };
const swung = hingedRootPose(doorRoot, [9, 9, 9], hinge, new Vector3(0, 1, 0), -90);
near(swung.pos.toArray(), [1.95, 0, 0.45], 1e-6, "the door base swings about the hinge pivot");
near(swung.quat.toArray(), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2).toArray(), 1e-6, "turned -90 deg about the hinge axis");
const tilted = hingedRootPose(doorRoot, [1.5, 0.6, 0], hinge, new Vector3(1, 0, 0), 40);
near(tilted.quat.toArray(), [0, 0, 0, 1], 1e-9, "a turn across the hinge axis does not move the door");
const leaning = hingedRootPose(doorRoot, [1.5, 0.6, 0], hinge, new Vector3(1, 1, 0), 40);
near([2 * Math.atan2(leaning.quat.y, leaning.quat.w) * 180 / Math.PI], [40 / Math.SQRT2], 1e-6, "a slanted ring keeps its share about the axis");
assert.deepEqual(keyObjectArgs("char-a", "door", 30, swung, { hinge: true }), { characterId: "char-a", objectId: "door", frame: 30, rot: [0, -0.7071, 0, 0.7071] });

// (c) The tip trail: the bat's top on every in-hand frame, plus its key frames in hand.
const trail = tipTrail(lookup, "bat", { track: tracks.get("bat") }, take, [2, 5]);
assert.equal(trail.points.length, 4, "frames 1..4 are in hand");
near(trail.points[0], [grip[0] + 0.84, grip[1], grip[2]], 1e-5, "the tip is the far end of the bat");
assert.equal(trail.keys.length, 1, "a key outside the hold is not drawn");
assert.equal(tipTrail(lookup, "bat", { track: tracks.get("door") }, take), null, "a hinge has no hand arc");
console.log("PASS held-object pose: gizmo on the drawn pose, root drags about it, previews, key args, tip trail");
