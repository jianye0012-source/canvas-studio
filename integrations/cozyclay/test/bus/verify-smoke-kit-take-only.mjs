#!/usr/bin/env node
// The smoking kits' lit parts are showOnlyInTake: the cigarette's ember, its light and the tip smoke,
// the lighter's flame and its light, and the exhale puff. In a static scene none of them draws or
// emits; the bodies do. A take that binds them (smokeCigarette args.kit, the squat of the live
// sessions) shows them on exactly the frames it did before the flag, emits the same particles and
// compiles from the same motion scene. The exhale puff has no channel of its own: its root's
// visible "exhale" drives it.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { bakeTake } from "../../src/motion3/take.js";
import { objectTracksOf } from "../../src/motion3/object-tracks.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { sceneObjectsAt, trackShown } from "../../src/object-travel.js";
import { evaluateEffects } from "../../src/effects/simulate.js";
import { effectSceneOf, effectStateIn } from "../../src/effects/state.js";
import { buildKit, KIT_NAMES } from "../../src/kits/index.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}

// 1. exactly these parts are take-only; bodies, roots, the bat and sword trails and the ball are not
const TAKE_ONLY = { cigarette: ["ember", "light", "smoke"], lighter: ["flame", "light"], exhale: ["puff"], pistol: ["flash", "light"] };
const kits = {};
let all = [];
for (const kit of KIT_NAMES) { kits[kit] = buildKit(kit, all, { position: { x: 0.6 + all.length * 0.01, z: 0.6 } }); all = [...all, ...kits[kit].records]; }
for (const kit of KIT_NAMES) {
	const k = kits[kit], flagged = Object.keys(k.parts).filter(role => k.records.find(r => r.id === k.parts[role]).showOnlyInTake === true).sort();
	expect(`${kit}: take-only parts [${flagged}]`, JSON.stringify(flagged) === JSON.stringify([...(TAKE_ONLY[kit] ?? [])].sort()) && k.records[0].showOnlyInTake === undefined, JSON.stringify(flagged));
}

const cig = kits.cigarette, lit = kits.lighter, ex = kits.exhale;
const records = [...cig.records, ...lit.records, ...ex.records];
// the same records without the flag: what every renderer drew before it
const plain = records.map(({ showOnlyInTake: _flag, ...record }) => record);
const lookup = new Map(records.map(r => [r.id, r])), plainLookup = new Map(plain.map(r => [r.id, r]));
const LIT = { ember: cig.parts.ember, emberLight: cig.parts.light, smoke: cig.parts.smoke, flame: lit.parts.flame, flameLight: lit.parts.light, puff: ex.parts.puff };
const SHOWN = { cigBody: cig.parts.body, lighterBody: lit.parts.body, cigRoot: cig.rootId, lighterRoot: lit.rootId, exhaleRoot: ex.rootId };

// 2. a static scene: no take, or a take that binds none of these kits
const other = { frameCount: 48, fps: 24, objectTracks: new Map([["somewhere-else", { frameCount: 48, vis: new Uint8Array(48).fill(1) }]]) };
for (const [label, take] of [["no take", null], ["an empty take", {}], ["a take that binds other records", other]]) {
	const hidden = Object.entries(LIT).filter(([, id]) => trackShown(id, 10, take, lookup)).map(([role]) => role);
	const bodies = Object.entries(SHOWN).filter(([, id]) => !trackShown(id, 10, take, lookup)).map(([role]) => role);
	expect(`${label}: the ember, flame, their lights, the tip smoke and the puff are hidden; bodies and roots are shown`, !hidden.length && !bodies.length, JSON.stringify({ shown: hidden, hiddenBodies: bodies }));
}
const drawn = new Map(sceneObjectsAt(records, 10, {}).map(r => [r.id, r]));
expect("sceneObjectsAt draws the lit parts hidden and the bodies shown", Object.values(LIT).every(id => drawn.get(id).hidden === true) && Object.values(SHOWN).every(id => drawn.get(id).hidden !== true));
const staticScene = list => ({ ...effectSceneOf(list), take: { frameCount: 48, fps: 24 } });
const before = ["smoke", "puff"].map(role => effectStateIn(staticScene(plain), LIT[role], 40).alive), after = ["smoke", "puff"].map(role => effectStateIn(staticScene(records), LIT[role], 40).alive);
expect(`a static tip smoke and exhale puff emit nothing (before the flag: ${before.join(" and ")} particles at f40)`, before.every(n => n > 0) && after.every(n => n === 0), JSON.stringify({ before, after }));

// 3. a take that binds them: the squat smoke of the live sessions with args.kit
const sk = skeletonFor("y-bot-tpose");
expect("the flag does not reach the motion scene the take compiles from", JSON.stringify(motionScene(records)) === JSON.stringify(motionScene(plain)));
const SQUAT = { root: [0, 0.5, -0.08], foot_l: [0.17, 0.087, 0.12], foot_r: [-0.17, 0.087, 0.12], knee_l: [0.5, 0.2, 1], knee_r: [-0.5, 0.2, 1], fyaw_l: 15, fyaw_r: -15, fpitch_l: 10, fpitch_r: 10,
	pitch: 28, spine_pitch: 5, head_pitch: -18, yaw: 0 };
const smoke = compileSpec({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 265, fix: { retime: true }, keys: [{ f: 0, set: SQUAT }],
	use: [{ skill: "smokeCigarette", f0: 0, args: { kit: { cig: cig.rootId, lighter: lit.rootId, exhale: ex.rootId } } }] }, { sk, scene: motionScene(records) });
const baked = bakeTake(sk, smoke.out), take = { frameCount: baked.frameCount, fps: 24, objectTracks: objectTracksOf({ motionFor: () => baked }, [{ id: "c" }]) };
const ids = [...Object.values(LIT), ...Object.values(SHOWN)], differ = [], shownFrames = Object.fromEntries(Object.keys(LIT).map(role => [role, 0]));
for (let f = 0; f < baked.frameCount; f += 1) {
	for (const id of ids) if (trackShown(id, f, take, lookup) !== trackShown(id, f, take, plainLookup)) differ.push([id, f]);
	for (const [role, id] of Object.entries(LIT)) shownFrames[role] += trackShown(id, f, take, lookup) ? 1 : 0;
	if (f % 4 === 0) {
		const now = new Map(sceneObjectsAt(records, f, take).map(r => [r.id, r.hidden === true])), was = new Map(sceneObjectsAt(plain, f, take).map(r => [r.id, r.hidden === true]));
		for (const id of ids) if (now.get(id) !== was.get(id)) differ.push(["sceneObjectsAt", id, f]);
	}
}
console.log(`  squat smoke, QA ${smoke.qa.total}: frames shown of ${baked.frameCount} ${JSON.stringify(shownFrames)}`);
expect("with the take, every part is shown on exactly the frames it was before the flag (trackShown and sceneObjectsAt)", !differ.length, JSON.stringify(differ.slice(0, 6)));
expect("the take shows each lit part on some frames and hides it on others", Object.values(shownFrames).every(n => n > 0 && n < baked.frameCount), JSON.stringify(shownFrames));
const particles = (list, id, f) => {
	const rows = [];
	evaluateEffects(list.filter(r => r.renderer === "effect"), { lookup: new Map(list.map(r => [r.id, r])), take, hidden: new Set() }, f, { only: id, particle: (p, em) => em.id === id && rows.push([p.s, p.k, p.x, p.y, p.z, p.size, p.alpha]) });
	return rows;
};
const samples = [80, 125, 133, 206, 247, 255].flatMap(f => [LIT.smoke, LIT.puff].map(id => [f, id, particles(records, id, f), particles(plain, id, f)]));
expect(`with the take, the tip smoke and the puff emit the same particles as before (${samples.reduce((n, s) => n + s[2].length, 0)} at the sampled frames)`,
	samples.every(([, , now, was]) => JSON.stringify(now) === JSON.stringify(was)) && samples.some(s => s[1] === LIT.smoke && s[2].length > 0) && samples.some(s => s[1] === LIT.puff && s[2].length > 0),
	JSON.stringify(samples.map(([f, id, now, was]) => [f, id, now.length, was.length])));

if (failures) { console.error(`${failures} smoke kit take-only check(s) failed`); process.exit(1); }
console.log("verify-smoke-kit-take-only: all checks passed");
