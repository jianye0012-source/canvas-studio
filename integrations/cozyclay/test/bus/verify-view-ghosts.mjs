// Onion-skin ghosts (src/view-ghosts.js, src/ghost-set.js, view.setGhosts): which frames get a
// ghost, how each looks, the key frames of a take, the ghost set on a small synthetic rig (posed
// from the take only when its frame changes, on one layer, never hit by a ray, carried props at
// their tracked pose) and the agent's door through run_action.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { GHOST_COLORS, GHOST_COUNT, GHOST_MODES, GHOST_STEP, describeGhosts, ghostFrames, ghostLook, ghostSettings, normalizeGhostSettings, setGhostSettings, sheetGhostSettings, takeKeyFrames } from "../../src/view-ghosts.js";
import { GhostSet, propSources, renderWithGhosts, rideIds, takeTracks } from "../../src/ghost-set.js";
import { studioActionDeclaration } from "../../src/studio-actions.js";
import { primeBindPose } from "../../src/poses.js";
import { SWING_SPEC, SWING_KEYS } from "../motion3/fixtures/bat-swing.mjs";
import { appFixture } from "./app-fixture.mjs";

const LAYER = 5;

test("ghostFrames: count each side every step frames, nearest first, inside the take", () => {
	const at = (frame, extra = {}) => ghostFrames({ frame, last: 95, mode: "step", count: 3, step: 4, ...extra });
	assert.deepEqual(at(20).map(({ f, side, rank }) => `${side}${rank}:${f}`), ["before1:16", "after1:24", "before2:12", "after2:28", "before3:8", "after3:32"]);
	assert.deepEqual(at(2).map((e) => e.f), [6, 10, 14], "no ghost before frame 0");
	assert.deepEqual(at(93).map((e) => e.f), [89, 85, 81], "no ghost past the take's last frame");
	assert.deepEqual(ghostFrames({ frame: 20, last: 95, mode: "off", count: 3, step: 4 }), []);
	const keys = [0, 24, 34, 40, 44, 47, 53, 57, 62, 74];
	const around = ghostFrames({ frame: 47, last: 95, mode: "keys", count: 3, step: 4, keyFrames: keys });
	assert.deepEqual(around.filter((e) => e.side === "before").map((e) => e.f), [44, 40, 34], "the key on the playhead is not a ghost");
	assert.deepEqual(around.filter((e) => e.side === "after").map((e) => e.f), [53, 57, 62]);
	assert.deepEqual(ghostFrames({ frame: 5, last: 95, mode: "keys", count: 2, step: 4, keyFrames: [200, 0, 0, 9] }).map((e) => e.f), [0, 9], "keys deduplicated, clamped to the take");
});

test("settings: normalized, clamped, transient; looks fade with distance", () => {
	assert.deepEqual([...GHOST_MODES], ["off", "step", "keys"]);
	assert.deepEqual(normalizeGhostSettings({ mode: "sideways", count: 40, step: 0 }), { mode: "off", count: GHOST_COUNT.max, step: GHOST_STEP.min });
	assert.equal(ghostSettings().mode, "off", "off by default");
	assert.deepEqual(sheetGhostSettings(), { mode: "step", count: 3, step: 4 }, "a sheet draws 3 each side every 4 frames while the viewport is off");
	setGhostSettings({ mode: "keys", count: 2 });
	assert.deepEqual(ghostSettings(), { mode: "keys", count: 2, step: 4 });
	assert.deepEqual(sheetGhostSettings(), ghostSettings(), "and the viewport's setting while it is on");
	assert.match(describeGhosts(ghostSettings()), /2 before and 2 after .* key frames/);
	setGhostSettings({ mode: "off", count: 3 });
	const looks = [1, 2, 3].map((rank) => ghostLook("before", rank, 3));
	assert.ok(looks[0].opacity > looks[1].opacity && looks[1].opacity > looks[2].opacity && looks[2].opacity > 0, JSON.stringify(looks));
	assert.equal(ghostLook("after", 1, 3).color, GHOST_COLORS.after);
	assert.notEqual(GHOST_COLORS.before, GHOST_COLORS.after);
	// The declaration (data shared with the sidecar) states the same enum and ranges.
	const input = studioActionDeclaration("view.setGhosts").input;
	assert.deepEqual(input.properties.mode.enum, [...GHOST_MODES]);
	assert.deepEqual([input.properties.count.minimum, input.properties.count.maximum, input.properties.step.minimum, input.properties.step.maximum], [GHOST_COUNT.min, GHOST_COUNT.max, GHOST_STEP.min, GHOST_STEP.max]);
	assert.deepEqual(input.required, ["mode"]);
});

test("takeKeyFrames: the spec's keys, held-object keys and skills, ascending", () => {
	const bat = { schema: "cozyclay.take.v3", rig: "y-bot-tpose", spec: { ...SWING_SPEC, objects: { cylinder: { ...SWING_SPEC.objects.cylinder, keys: SWING_KEYS } } } };
	const keys = takeKeyFrames(bat);
	assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
	for (const f of [0, 24, 47, 57, 74]) assert.ok(keys.includes(f), `key frame ${f} in ${keys}`);
	assert.equal(takeKeyFrames(bat), keys, "cached per take");
	const idle = { schema: "cozyclay.take.v3", rig: "y-bot-tpose", spec: { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 48, use: [{ skill: "standIdle", args: { at: [0, 0], heading: 0 }, f0: 0 }] } };
	assert.ok(takeKeyFrames(idle).length > 0, "a skill's keys count");
	assert.deepEqual(takeKeyFrames({ schema: "cozyclay.take.v2" }), []);
});

/** A two-bone rig under a placed character group, a take that turns the spine per frame, a carried record. */
function stage() {
	const scene = new THREE.Scene(), character = new THREE.Group();
	character.position.set(1, 0, -2);
	const rig = new THREE.Group(), hips = new THREE.Bone(), spine = new THREE.Bone();
	hips.name = "mixamorig:Hips"; spine.name = "mixamorig:Spine"; spine.position.set(0, 10, 0);
	hips.add(spine);
	const geometry = new THREE.BoxGeometry(1, 20, 1, 1, 2, 1), count = geometry.attributes.position.count;
	geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0).map((_, i) => (i % 4 === 0 ? (geometry.attributes.position.getY(i / 4) > 0 ? 1 : 0) : 0)), 4));
	geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Array(count * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
	const body = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
	rig.add(hips, body);
	body.bind(new THREE.Skeleton([hips, spine]));
	rig.scale.setScalar(0.01);
	character.add(rig);
	scene.add(character);
	primeBindPose(rig);
	const F = 12, rot = new Float32Array(F * 2 * 4), hipsPos = new Float32Array(F * 3), pos = new Float32Array(F * 3), quat = new Float32Array(F * 4);
	for (let f = 0; f < F; f++) {
		rot.set([0, 0, 0, 1], f * 8);
		rot.set(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), f * 0.1).toArray(), f * 8 + 4);
		hipsPos.set([0, 0.9, 0.01 * f], f * 3);
		pos.set([0.5, 1, 0.1 * f], f * 3);
		quat.set([0, 0, 0, 1], f * 4);
	}
	const take = { schema: "cozyclay.take.v3", frameCount: F, fps: 24, bones: ["Hips", "Spine"], rot, hips: hipsPos, objects: { bat: { pos, quat } } };
	// The carried record as props.jsx mounts it: a group tagged with its id, a drawn mesh and an editor marker.
	const objects = [{ id: "bat", renderer: "cube", x: 0.5, y: 1, z: 0, rot: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
		{ id: "barrel", renderer: "cube", parent: "bat", x: 0.5, y: 1.5, z: 0, rot: 0, scaleX: 1, scaleY: 1, scaleZ: 1 }, { id: "plate", renderer: "cube", x: 0, y: 0, z: 1 }];
	const record = new THREE.Group(), drawn = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.05)), marker = new THREE.Mesh(new THREE.SphereGeometry(0.1));
	record.userData = { sceneObjectId: "bat" };
	drawn.position.set(0, 0.4, 0);
	marker.layers.set(LAYER);
	record.add(drawn, marker);
	record.position.set(0.5, 1, 0);
	scene.add(record);
	scene.updateMatrixWorld(true);
	return { scene, rig, take, objects, propTake: { frameCount: F, fps: 24, objectTracks: takeTracks(take) } };
}

test("GhostSet: one clone per ghost, posed from the take, on one layer, never hit by a ray", () => {
	const { scene, rig, take, objects, propTake } = stage(), set = new GhostSet({ layer: LAYER });
	assert.deepEqual(rideIds(objects, take), ["bat", "barrel"], "the carried record and what is grouped under it");
	const sources = propSources(scene, ["bat"]);
	assert.equal(sources.length, 1);
	assert.equal(sources[0].meshes.length, 1, "the editor marker (not on layer 0) is left out");
	set.setRig(rig);
	set.setSources(sources);
	scene.add(set.object);
	const entries = ghostFrames({ frame: 6, last: take.frameCount - 1, mode: "step", count: 2, step: 2 });
	set.update({ entries, take, placement: rig.parent.matrixWorld, propTake, objects, count: 2 });
	assert.equal(set.slots.length, 4);
	assert.equal(set.stats.poses, 4);
	for (const [i, entry] of entries.entries()) {
		let spine = null;
		set.slots[i].rig.traverse((node) => { if (node.name === "mixamorig:Spine") spine = node; });
		assert.ok(Math.abs(spine.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), entry.f * 0.1))) < 2e-3, `slot ${i} shows frame ${entry.f}`);
		const prop = set.slots[i].records[0].group;
		assert.ok(prop.visible && Math.abs(new THREE.Vector3().setFromMatrixPosition(prop.matrix).z - 0.1 * entry.f) < 1e-6, `the bat ghost stands where the take has it at ${entry.f}`);
		const look = ghostLook(entry.side, entry.rank, 2);
		assert.equal(set.slots[i].material.opacity, look.opacity);
		assert.ok(entry.side === "before" ? set.slots[i].material.color.b > set.slots[i].material.color.r : set.slots[i].material.color.r > set.slots[i].material.color.b, `${entry.side} hue`);
	}
	assert.ok(set.body.matrix.equals(rig.parent.matrixWorld), "the body ghosts ride the character's placement");
	let onOther = 0, meshes = 0;
	set.object.traverse((node) => { if (node !== set.object && node !== set.body && node !== set.props && node.layers.mask !== 1 << LAYER) onOther += 1; if (node.isMesh) meshes += 1; });
	assert.equal(onOther, 0, "every ghost node is on the ghost layer only");
	scene.updateMatrixWorld(true);
	const ray = new THREE.Raycaster(new THREE.Vector3(1.5, 1, 5), new THREE.Vector3(0, 0, -1));
	ray.layers.enableAll();
	assert.ok(meshes >= 8);
	assert.deepEqual(ray.intersectObject(set.object, true), [], "a ghost takes no pick");
	// Same frames again: nothing is posed; a new playhead re-poses only what moved.
	set.update({ entries, take, placement: rig.parent.matrixWorld, propTake, objects, count: 2 });
	assert.equal(set.stats.poses, 4);
	set.update({ entries: ghostFrames({ frame: 7, last: take.frameCount - 1, mode: "step", count: 2, step: 2 }), take, placement: rig.parent.matrixWorld, propTake, objects, count: 2 });
	assert.equal(set.stats.poses, 8);
	set.update({ entries: entries.slice(0, 1), take, placement: rig.parent.matrixWorld, propTake, objects, count: 2 });
	assert.deepEqual(set.slots.map((slot) => slot.rig.visible), [true, false, false, false], "unused slots hide, kept for reuse");
	// The live rig is never touched.
	let live = null;
	rig.traverse((node) => { if (node.name === "mixamorig:Spine") live = node; });
	assert.ok(live.quaternion.equals(new THREE.Quaternion()), "the live rig keeps its own pose");
	set.dispose();
	assert.equal(set.slots.length, 0);
});

test("renderWithGhosts: a capture sees the ghosts on layer 0 for that render only", () => {
	const { scene, rig, take, objects } = stage();
	setGhostSettings({ mode: "off" });
	let seen = null;
	const out = renderWithGhosts({ rig, take, objects }, 6, () => {
		const ghosts = scene.children.find((node) => node.userData.ghost);
		const shown = ghosts?.children[0].children.filter((slot) => slot.visible) ?? [];
		let offLayer = 0;
		ghosts?.traverse((node) => { if (node.isMesh && !node.layers.isEnabled(0)) offLayer += 1; });
		seen = { shown: shown.length, offLayer };
		return "pixels";
	});
	assert.equal(out, "pixels");
	assert.deepEqual(seen, { shown: 2, offLayer: 0 }, "frames 2 and 10 (3 each side every 4 frames, inside the 12-frame take), on layer 0");
	assert.equal(scene.children.some((node) => node.userData.ghost), false, "taken out after the render");
	assert.equal(renderWithGhosts({ rig: null, take, objects }, 6, () => "plain"), "plain");
});

test("view.setGhosts: a transient run_action that sets the viewer setting", () => {
	const f = appFixture();
	try {
		const run = (args) => f.binding.handlers.run_action(f.request("run_action", { action: "view.setGhosts", args }));
		const on = run({ mode: "step", count: 3, step: 4 });
		assert.equal(on.ok, true, JSON.stringify(on));
		assert.equal(on.status, "transient");
		assert.equal(on.undo, null);
		assert.deepEqual(ghostSettings(), { mode: "step", count: 3, step: 4 });
		assert.match(on.summary, /3 before and 3 after .* every 4 frames/);
		const refused = run({ mode: "step", count: 9 });
		assert.equal(refused.ok, false);
		assert.equal(refused.code, "INVALID_ARGUMENT");
		assert.deepEqual(ghostSettings(), { mode: "step", count: 3, step: 4 }, "a refused call changes nothing");
		assert.equal(run({ mode: "off" }).ok, true);
		assert.equal(ghostSettings().mode, "off");
	} finally { f.dispose(); }
});
