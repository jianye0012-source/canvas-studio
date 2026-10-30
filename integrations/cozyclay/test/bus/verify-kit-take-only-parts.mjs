#!/usr/bin/env node
// The pistol kit's muzzle flash and its light are showOnlyInTake: in a static scene (no take, or a
// take that does not bind muzzle_vis) they are hidden; a take's muzzle_vis track shows them on its
// frames. The flag survives the record normalizer and edits, and every other kit part stays as it was.
import { buildKit, KIT_NAMES } from "../../src/kits/index.js";
import { normalizeSceneObject, updateSceneObject } from "../../src/scene-objects.js";
import { sceneObjectsAt, trackShown } from "../../src/object-travel.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}

const pistol = buildKit("pistol", [], { position: { x: 0.4, z: 0.3 } }), records = pistol.records, { flash, light, body } = pistol.parts;
const lookup = new Map(records.map(r => [r.id, r]));
expect("the flash and its light are showOnlyInTake, the body and the root are not",
	records.filter(r => r.showOnlyInTake).map(r => r.id).sort().join() === [flash, light].sort().join(), JSON.stringify(records.map(r => [r.id, r.showOnlyInTake])));
let others = [];
// the smoking kits' lit parts are take-only too (verify-smoke-kit-take-only.mjs)
for (const kit of KIT_NAMES.filter(k => !["pistol", "cigarette", "lighter", "exhale"].includes(k))) others = [...others, ...buildKit(kit, others).records];
expect("no part of the bat, ball or sword is", others.length > 0 && !others.some(r => "showOnlyInTake" in r));

// static: no take, and a take that binds only the pistol's carry
const carryOnly = { frameCount: 10, objectTracks: new Map([[pistol.rootId, { frameCount: 10, pos: new Float32Array(30), quat: new Float32Array(40).fill(0).map((_, i) => (i % 4 === 3 ? 1 : 0)) }]]) };
for (const [label, take] of [["no take", null], ["a take without muzzle_vis", carryOnly]]) {
	expect(`${label}: the flash and the light are hidden, the body is shown`, !trackShown(flash, 3, take, lookup) && !trackShown(light, 3, take, lookup) && trackShown(body, 3, take, lookup));
}
const drawn = sceneObjectsAt(records, 0, {});
expect("sceneObjectsAt draws them hidden in a static scene", drawn.find(r => r.id === flash).hidden === true && drawn.find(r => r.id === light).hidden === true
	&& drawn.find(r => r.id === body).hidden === false);

// a take that binds muzzle_vis: shown on its frames only
const vis = new Uint8Array(10); vis[5] = 1;
const firing = { frameCount: 10, objectTracks: new Map([[flash, { frameCount: 10, vis }], [light, { frameCount: 10, vis }]]) };
expect("a muzzle_vis track shows them on its frames (f5) and hides them elsewhere (f4)", trackShown(flash, 5, firing, lookup) && trackShown(light, 5, firing, lookup)
	&& !trackShown(flash, 4, firing, lookup) && !trackShown(light, 4, firing, lookup));

// the flag survives a reload and an edit
const flashRecord = lookup.get(flash);
expect("the record normalizer keeps the flag; anything but true drops it", normalizeSceneObject(flashRecord).showOnlyInTake === true
	&& !("showOnlyInTake" in normalizeSceneObject({ ...flashRecord, showOnlyInTake: "yes" })));
const moved = updateSceneObject(records, pistol.rootId, { x: 1 });
expect("moving the kit keeps the flag on its carried parts", moved.find(r => r.id === flash).showOnlyInTake === true && moved.find(r => r.id === flash).x !== flashRecord.x);

if (failures) { console.error(`${failures} take-only part check(s) failed`); process.exit(1); }
console.log("verify-kit-take-only-parts: all checks passed");
