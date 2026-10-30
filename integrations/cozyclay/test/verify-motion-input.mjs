#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	activeSceneCharacters,
	characterHandleId,
	characterIdFromHandle,
	connectedCharacterIds,
	motionInputOutput,
	normalizeMotionInputData,
	parseMotionSpec,
} from "../src/workflow/motion-input.js";

const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 48, use: [{ skill: "standIdle", f0: 0 }] };
const normalized = normalizeMotionInputData({ spec, targetCharacterId: "char-a", fileName: "walk.json" });
assert.equal(normalized.status, "ready");
assert.equal(normalized.characterId, "char-a");
assert.equal(normalized.frames, 48);
assert.equal(normalizeMotionInputData({ spec: { schema: "other" } }).status, "idle", "only a motion spec is ready");
assert.deepEqual(parseMotionSpec(JSON.stringify(spec)), spec);
assert.equal(parseMotionSpec("not json"), null);
assert.equal(parseMotionSpec(JSON.stringify({ schema: "cozyclay.motion-spec.v1" })), null, "a spec needs its frame count");
assert.equal(characterHandleId("char-a"), "character:char-a");
assert.equal(characterIdFromHandle("character:char-a"), "char-a");
assert.equal(characterIdFromHandle("motion"), null);

const output = motionInputOutput(normalized);
assert.deepEqual({ characterId: output.characterId, handle: output.handle, frames: output.frames, spec: output.spec }, {
	characterId: "char-a", handle: "character:char-a", frames: 48, spec,
});

const edges = [
	{ source: "motion-1", target: "scene-1", targetHandle: "character:char-a" },
	{ source: "motion-2", target: "scene-1", targetHandle: "character:char-b" },
	{ source: "motion-3", target: "scene-2", targetHandle: "character:char-c" },
];
assert.deepEqual(connectedCharacterIds(edges, "scene-1"), ["char-a", "char-b"]);

const storage = new Map([["cozyclay.scenes.v5", JSON.stringify({ version: 4, activeSceneId: "scene-2", scenes: [
	{ id: "scene-1", name: "One", objects: [], stage: { characters: [{ id: "old" }] } },
	{ id: "scene-2", name: "Two", objects: [], stage: { characters: [{ id: "char-a", subject: "Hero", model: "x-bot-tpose" }] } },
] })]]);
const fakeStorage = { getItem: (key) => storage.get(key) ?? null };
assert.deepEqual(activeSceneCharacters(fakeStorage), [{ id: "char-a", name: "Hero", model: "x-bot-tpose" }]);

console.log("motion input adapter checks passed");
