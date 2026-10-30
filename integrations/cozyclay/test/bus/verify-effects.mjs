#!/usr/bin/env node
// Effects (src/effects/): the object.effect record, the deterministic particle
// simulation and the agent readback. Pure Node; the renderer draws exactly
// what evaluateEffects answers here.
import assert from "node:assert/strict";
import { Matrix4, Vector3 } from "three";
import { createSceneObject, normalizeSceneObject, OBJECT_LIBRARY, OBJECT_MENU_ENTRIES } from "../../src/scene-objects.js";
import { studioObjectCatalogue } from "../../src/studio-agent-commands.js";
import { sceneObjectTravelMatrixAt } from "../../src/object-travel.js";
import { EFFECT_PRESETS, EFFECT_VALUE_SCHEMA, effectPresetSet, normalizeEffect } from "../../src/effects/effect-record.js";
import { EFFECT_PARTICLE_CAP, evaluateEffects } from "../../src/effects/simulate.js";
import { effectSceneOf, effectStateAt, effectStateIn, publishEffectScene, withEffectState } from "../../src/effects/state.js";
import { elementByPath } from "../../src/studio-elements.js";
import { patchValueSchema, validateStudioSchema } from "../../src/studio-agent-protocol.js";

const FPS = 24, FRAMES = 96;
const effect = (id, effectValue, extra = {}) => normalizeSceneObject({ ...createSceneObject("effect", []), id, name: id, ...extra, effect: effectValue });
const sceneOf = (objects, take = {}) => ({ ...effectSceneOf(objects), take: { frameCount: FRAMES, fps: FPS, ...take } });
/** Every drawn particle at `frame`, as plain rows. */
function particles(scene, frame, only = null) {
	const rows = [];
	evaluateEffects(scene.records, scene, frame, { only, particle: (p, em) => rows.push({ id: em.id, s: p.s, k: p.k, u: p.u, birth: [p.bx, p.by, p.bz], at: [p.x, p.y, p.z], size: p.size, alpha: p.alpha }) });
	return rows;
}
const worldAt = (objects, id, frame, take) => {
	const m = sceneObjectTravelMatrixAt(objects, id, frame, take, new Matrix4());
	return m ? new Vector3().setFromMatrixPosition(m).toArray() : null;
};
/** Where the emitter was at a particle's birth: frame s - u, between the poses at s - 1 and s. */
const bornAt = (p, at) => {
	const here = at(Math.max(0, p.s)), before = at(Math.max(0, p.s - 1));
	return here.map((v, i) => v + (before[i] - v) * p.u);
};
const close = (a, b, tol = 1e-9) => a.every((value, i) => Math.abs(value - b[i]) <= tol);

// --- The record -----------------------------------------------------------
assert.ok(!OBJECT_LIBRARY.some((entry) => entry.kind === "effect"), "the sized library stays sized (an effect is zero-size, like an empty)");
assert.ok(OBJECT_MENU_ENTRIES.some((entry) => entry.kind === "effect"), "effect is in the create menu");
assert.ok(studioObjectCatalogue().objects.some((row) => row.kind === "effect"), "inspect_studio { scope: catalogue } lists the effect kind");
const created = createSceneObject("effect", []);
assert.equal(created.renderer, "effect");
assert.deepEqual(created.effect, normalizeEffect({ preset: "smoke" }), "a new effect carries the merged smoke preset");
assert.deepEqual(created.footprint, { width: 0, depth: 0 }, "an effect has no body to collide with");
const fire = normalizeEffect({ preset: "fire", rate: 12, wind: { x: 1 } });
assert.equal(fire.rate, 12, "an explicit field overrides the preset");
assert.equal(fire.additive, true, "fire is additive");
assert.deepEqual(fire.wind, { x: 1, y: 0, z: 0 }, "a partial vector keeps the preset's other axes");
assert.equal(fire.life, EFFECT_PRESETS.fire.life, "unset fields take the preset's numbers");
assert.equal(normalizeEffect({ preset: "nope", rate: 1e9, opacity: -1, color: "#ABC" }).rate, 2000, "rate is clamped");
assert.deepEqual([normalizeEffect({ preset: "nope" }).preset, normalizeEffect({ opacity: -1 }).opacity, normalizeEffect({ color: "#ABC" }).color], ["smoke", 0, "#aabbcc"]);
assert.equal(normalizeSceneObject({ ...createSceneObject("cube", []), effect: { preset: "fire" } }).effect, undefined, "only effect records carry an effect");
assert.equal(normalizeSceneObject(created).effect.preset, "smoke", "a stored effect survives a reload");
// object.set merges a set onto the record, so a NEW preset is written out in full first.
const smokeRow = effect("tip", { preset: "smoke", seed: 7 });
const switched = effectPresetSet({ id: "tip", set: { effect: { preset: "fire", rate: 40 } } }, [smokeRow]).set.effect;
assert.deepEqual(normalizeEffect({ ...smokeRow.effect, ...switched }), normalizeEffect({ preset: "fire", rate: 40, seed: 7 }), "switching preset loads its defaults, keeps the seed and the given fields");
const same = { id: "tip", set: { effect: { preset: "smoke", rate: 9 } } };
assert.equal(effectPresetSet(same, [smokeRow]), same, "the same preset merges as an ordinary set");
// The agent-facing declaration carries a value schema the patch path validates against.
assert.equal(elementByPath("object.effect").type, "object");
assert.ok(elementByPath("object.renderer").enum.includes("effect"));
assert.equal(patchValueSchema(elementByPath("object.effect")), EFFECT_VALUE_SCHEMA);
validateStudioSchema(EFFECT_VALUE_SCHEMA, { preset: "rain", area: { x: 4 }, wind: { x: 0.5, y: 0, z: 0 } });
assert.throws(() => validateStudioSchema(EFFECT_VALUE_SCHEMA, { preset: "rain", sparkle: 1 }));

// --- A routed smoke emitter -------------------------------------------------
const route = { points: [{ x: -1, y: 1, z: 0 }, { x: 1, y: 1.2, z: 0.5 }] };
const routed = effect("smoke", { preset: "smoke" }, { x: -1, y: 1, z: 0, path: route });
const rain = effect("rain", { preset: "rain", rate: 300 }, { x: 3, z: 3 });
const flame = effect("fire", { preset: "fire" }, { x: -2, z: 1 });
const stick = normalizeSceneObject({ ...createSceneObject("cylinder", []), id: "stick", x: 0, y: 1, z: 0, path: { points: [{ x: 0, y: 1, z: 0 }, { x: 0.6, y: 1.3, z: 0.6 }, { x: 0, y: 1.1, z: 1.2 }], speed: 6 } });
const swoosh = effect("swoosh", { preset: "trail", width: 0.4 }, { x: 0, y: 1, z: 0, parent: "stick" });
const objects = [routed, rain, flame, stick, swoosh];
const scene = sceneOf(objects);

// Same frame, same particles, whatever was evaluated before it and in what order.
const frames = [0, 7, 30, 31, 58, 95];
const forward = frames.map((frame) => JSON.stringify(particles(scene, frame)));
const shuffled = [58, 0, 95, 31, 7, 30, 58];
const replay = new Map(shuffled.map((frame) => [frame, JSON.stringify(particles(sceneOf(objects.map((o) => ({ ...o }))), frame))]));
frames.forEach((frame, i) => { if (replay.has(frame)) assert.equal(replay.get(frame), forward[i], `frame ${frame} is the same in any evaluation order`); });
assert.equal(JSON.stringify(particles(scene, 30)), forward[2], "re-evaluating a frame changes nothing");
assert.notEqual(forward[2], forward[3], "consecutive frames differ");

// Every particle is born where the emitter was at its birth frame.
const born = particles(scene, 40, "smoke");
assert.ok(born.length > 40, `a cigarette-scale smoke stream has particles (${born.length})`);
for (const p of born) {
	const at = bornAt(p, (f) => worldAt(objects, "smoke", f, scene.take));
	assert.ok(close(p.birth, at), `particle ${p.s}/${p.k} born at ${p.birth} not the emitter's ${at}`);
	if (p.u < 1e-3) assert.ok(close(p.birth, worldAt(objects, "smoke", Math.max(0, p.s), scene.take), 1e-6), "a particle born on the frame is born at that frame's pose");
}
const birthFrames = [...new Set(born.map((p) => p.s))].filter((s) => s >= 0);
assert.ok(birthFrames.length > 20, "births spread over many frames");
assert.ok(Math.abs(born.find((p) => p.s === Math.min(...birthFrames)).birth[0] - born.find((p) => p.s === Math.max(...birthFrames)).birth[0]) > 0.3, "a moving emitter leaves births along its route");

// A carried emitter: grouped under a routed parent, and held through a take track.
const holder = normalizeSceneObject({ ...createSceneObject("cube", []), id: "holder", x: 0, y: 1, z: 0, path: { points: [{ x: 0, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }] } });
const tip = effect("tip", { preset: "smoke" }, { x: 0.1, y: 1.3, z: 0, parent: "holder" });
const held = effect("held", { preset: "exhale", area: { x: 0, y: 0, z: 0 } }, { x: 0, y: 1.5, z: 0 });
const F = FRAMES, pos = new Float32Array(F * 3), quat = new Float32Array(F * 4), hold = new Uint8Array(F).fill(1);
for (let f = 0; f < F; f += 1) { pos.set([Math.sin(f / 9), 1.4 + f / 200, Math.cos(f / 9)], f * 3); quat.set([0, Math.sin(f / 40), 0, Math.cos(f / 40)], f * 4); }
const carriedTake = { objectTracks: new Map([["held", { frameCount: F, pos, quat, hold }]]) };
const carried = sceneOf([holder, tip, held], carriedTake);
for (const p of particles(carried, 50)) {
	const at = bornAt(p, (f) => (p.id === "held" ? Array.from(pos.slice(f * 3, f * 3 + 3)) : worldAt([holder, tip, held], "tip", f, carried.take)));
	assert.ok(close(p.birth, at, 1e-6), `${p.id} particle ${p.s}/${p.k} born at the carried emitter`);
}
assert.ok(particles(carried, 50, "held").every((p) => p.s >= 50 - 3 * FPS), "births stay inside the life window");

// Hidden at frame s means no births at s; a take level scales the births.
// A take track that holds the record where it stands (the shape a carry entry with `visible` bakes).
const standing = (record, extra = {}) => ({ frameCount: F, pos: new Float32Array(F * 3).map((_, i) => [record.x, record.y, record.z][i % 3]),
	quat: new Float32Array(F * 4).map((_, i) => (i % 4 === 3 ? 1 : 0)), ...extra });
const vis = new Uint8Array(F).fill(1).fill(0, 10, 21), lvl = new Float32Array(F).fill(1).fill(0, 30, 34).fill(2, 40, 52);
const gate = { ...routed, path: null };
const gated = sceneOf([gate], { objectTracks: new Map([["smoke", standing(gate, { vis, lvl })]]) });
const gatedRows = particles(gated, 60);
assert.ok(gatedRows.length > 0);
assert.ok(!gatedRows.some((p) => (p.s >= 10 && p.s <= 20) || (p.s >= 30 && p.s <= 33)), "nothing is born while hidden or at level 0");
const perFrame = (from, to) => gatedRows.filter((p) => p.s >= from && p.s < to).length / (to - from);
assert.ok(perFrame(40, 52) > 1.5 * perFrame(52, 60), `level 2 doubles the births (${perFrame(40, 52)} vs ${perFrame(52, 60)})`);
const ancestorHidden = sceneOf([holder, tip], { objectTracks: new Map([["holder", standing(holder, { vis: new Uint8Array(F) })]]) });
assert.equal(particles(ancestorHidden, 40).length, 0, "an emitter under a hidden group emits nothing");

// --- Look at natural scale: cigarette smoke is thin, rises ~0.4 m and widens --
const still = effect("still", { preset: "smoke" }, { x: 0, y: 1, z: 0 });
const stillRows = particles(sceneOf([still]), 72);
const young = stillRows.filter((p) => (72 - p.s) / FPS < 0.3), old = stillRows.filter((p) => (72 - p.s) / FPS > 2);
const mean = (rows, i) => rows.reduce((sum, p) => sum + p.at[i], 0) / rows.length;
assert.ok(young.every((p) => p.size < 0.03), "smoke leaves the tip a few cm wide");
assert.ok(mean(old, 1) - 1 > 0.3 && mean(old, 1) - 1 < 0.6, `old smoke has risen ~0.4 m (${(mean(old, 1) - 1).toFixed(3)})`);
assert.ok(mean(old.map((p) => ({ at: [p.size] })), 0) > 3 * mean(young.map((p) => ({ at: [p.size] })), 0), "smoke widens as it rises");
assert.ok(particles(sceneOf([effect("drop", { preset: "sparks" }, { y: 0.2 })]), 40).every((p) => p.at[1] >= 0), "nothing falls through the deck");

// --- Trails ------------------------------------------------------------------
assert.equal(effectStateIn(sceneOf([effect("t", { preset: "trail" }, { y: 1 })]), "t", 40).alive, 0, "a still emitter draws no trail");
const swing = effectStateIn(scene, "swoosh", 4);
assert.ok(swing.alive > 0 && swing.bounds, `a swinging stick draws a swoosh (${JSON.stringify(swing)})`);
assert.equal(effectStateIn(scene, "swoosh", 60).alive, 0, "the trail is gone once the stick has stopped for longer than its life");

// --- Cap and readback ----------------------------------------------------------
const storm = sceneOf([0, 1, 2].map((i) => effect(`rain${i}`, { preset: "rain" }, { x: i * 9 })));
const stormStats = evaluateEffects(storm.records, storm, 30);
const alive = [...stormStats.values()].reduce((sum, st) => sum + st.alive, 0);
assert.ok(alive <= EFFECT_PARTICLE_CAP, `the scene draws at most ${EFFECT_PARTICLE_CAP} particles (${alive})`);
assert.ok([...stormStats.values()].every((st) => st.clamped > 0), "every thinned emitter reports it");
assert.ok(effectStateIn(storm, "rain1", 30).clamped > 0, "the readback reports the clamping");
const state = effectStateIn(scene, "smoke", 40);
assert.deepEqual(Object.keys(state), ["frame", "alive", "emitter", "bounds"]);
assert.ok(close(state.emitter, worldAt(objects, "smoke", 40, scene.take).map((v) => Math.round(v * 1000) / 1000)), "emitter is the world position at the frame");
assert.ok(state.bounds.min.every((v, i) => v <= state.bounds.max[i]) && state.bounds.max[1] > state.emitter[1] + 0.2, "bounds hold the plume above the tip");
assert.equal(effectStateIn(scene, "stick", 40), null, "a non-effect has no effect state");
publishEffectScene(() => scene);
assert.deepEqual(effectStateAt("smoke", 40), state, "effectStateAt reads the scene the renderer published");
assert.deepEqual(effectStateAt("smoke", 40, objects), effectStateIn({ ...effectSceneOf(objects), take: scene.take }, "smoke", 40), "fresher records can be handed in");
assert.deepEqual(withEffectState({ id: "smoke", renderer: "effect" }, 40, objects).effect, state, "an inspected effect row carries its state");
const cube = { id: "stick", renderer: "cylinder" };
assert.equal(withEffectState(cube, 40, objects), cube, "other rows are untouched");
const hiddenScene = sceneOf([{ ...still, hidden: true }]);
assert.equal(effectStateIn(hiddenScene, "still", 40).alive, 0, "an authored-hidden effect emits nothing");
publishEffectScene(null);
console.log(`effects: ${born.length} routed smoke particles born on the route, swoosh ${swing.alive} quads, storm ${alive} drops capped`);
