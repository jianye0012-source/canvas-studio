#!/usr/bin/env node
// Physical grasp (#816), throw: a fall can leave with a velocity (fall.v, flight.js), and throwObject throws what the hand
// carries at a point. A free ball leaving at 6 m/s lands at the analytic range; a thrown ball lands near the target at QA 0
// on both rigs; a fall without v is the fall of before (its poses pinned from the tree before fall.v); a carry let go with
// no fall stays where the hand let it go (C3: there is no implicit fall).
import { createHash } from "node:crypto";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { buildKit } from "../../src/kits/index.js";
import { objectPoseAt } from "../../src/motion3/object-pose.js";
import { G } from "../../src/motion3/free-motion.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` - ${detail}`}`);
	if (!condition) failures += 1;
}
const STAND = { skill: "standIdle", args: { at: [0, 0], heading: 0 }, f0: 0 };
const spec = (frames, objects, extra = {}) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames, use: [STAND, ...(extra.use ?? [])], objects, ...(extra.props ? { props: extra.props } : {}) });
const sk = skeletonFor("y-bot-tpose");

// a free ball leaving at [0, 0, 6] m/s, its centre 1.4 m up: it lands G-analytic range ahead (its lowest point falls to y 0)
{
	const kit = buildKit("ball", [], { position: { x: 0.5, y: 1.4, z: 0.5 } }), id = kit.rootId, scene = motionScene(kit.records);
	const r = compileSpec(spec(60, { [id]: { fall: { at: 0, v: [0, 0, 6] } } }), { sk, scene }), rest = objectPoseAt(r.out, id, 59).pos;
	const low = Math.min(...Object.values(scene.objects).map(e => e.pos[1])), range = 6 * Math.sqrt((2 * low) / G);
	console.log(`  free ball: landed ${(rest[2] - 0.5).toFixed(3)} m ahead, analytic ${range.toFixed(3)} m`);
	expect("a free ball with fall.v [0, 0, 6] from 1.4 m lands at the analytic range (G 9.8) within 0.05 m", Math.abs(rest[2] - 0.5 - range) <= 0.05 && Math.abs(rest[0] - 0.5) < 1e-6, rest.join());
}

// over a raised platform: coming down from 1.4 m at 4 m/s it reaches the platform's 1.0 m top above the platform (z 1.59),
// though at floor height it would be past it (z 2.6): it lands on the platform (PR #818 review)
{
	const kit = buildKit("ball", [], { position: { x: 0.5, y: 1.4, z: 0.5 } }), id = kit.rootId;
	const deck = { id: "deck", name: "deck", renderer: "cube", x: 0.5, y: 0, z: 1.8, rot: 0, rotX: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 0.8, footprint: { width: 1, depth: 1 }, height: 1 };
	const scene = motionScene([...kit.records, deck]), r = compileSpec(spec(60, { [id]: { fall: { at: 0, v: [0, 0, 4] } } }), { sk, scene }), rest = objectPoseAt(r.out, id, 59).pos;
	const low = Math.min(...Object.values(scene.objects).filter(e => e !== scene.objects.deck).map(e => e.pos[1])), z = 0.5 + 4 * Math.sqrt((2 * (low - 1)) / G);
	expect(`a throw over a raised platform lands on it (top 1.0 m, at z ${z.toFixed(3)} within 0.05 m)`, rest[1] > 0.99 && Math.abs(rest[2] - z) <= 0.05, rest.join());
}

// thrown at [0, 0, 5]: the ball carried by its pinned grip (so the throw is measured, not the grasp), its scene record
// where that grip holds it at the grab
const props = { ballGrip: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: {} } }, GRAB = 4;
const throwSpec = id => spec(80, { [id]: { prop: "ballGrip", at: [0, 0, -0.035], along: [0, 1, 0], grab: GRAB } }, { props, use: [{ skill: "throwObject", args: { object: id, to: [0, 0, 5] }, f0: 10 }] });
for (const rig of ["y-bot-tpose", "x-bot-tpose"]) {
	const rk = skeletonFor(rig), far = buildKit("ball", [], { position: { x: 2, y: 1, z: 2 } });
	const held = objectPoseAt(compileSpec(throwSpec(far.rootId), { sk: rk, scene: motionScene(far.records) }).out, far.rootId, GRAB).pos;
	const kit = buildKit("ball", [], { position: { x: held[0], y: held[1], z: held[2] } }), id = kit.rootId, r = compileSpec(throwSpec(id), { sk: rk, scene: motionScene(kit.records) });
	const fall = r.out.ctx.spec.objects[id].fall, release = r.out.ctx.spec.objects[id].release, at = f => objectPoseAt(r.out, id, f).pos;
	const hand = at(release).map((v, i) => (v - at(release - 1)[i]) * 24), rest = at(79), miss = Math.hypot(rest[0], rest[2] - 5);
	console.log(`  ${rig}: release f${release}, fall.v [${fall.v.join(", ")}] m/s, the hand gave it [${hand.map(v => v.toFixed(2)).join(", ")}] m/s; landed ${miss.toFixed(3)} m off`);
	expect(`${rig}: throwObject to [0, 0, 5] lands within 0.25 m of it`, miss <= 0.25, rest.join());
	expect(`${rig}: QA 0 and its landing goal met`, r.qa.total === 0 && r.qa.goals?.every(g => g.ok), r.qa.groups.map(g => `${g.kind}:${g.subject}`).join(" | ") + JSON.stringify(r.qa.goals));
	// the agent's own fall { v: "hand" } (the skill fills only what the entry leaves out) leaves with what the hand gave it
	const own = throwSpec(id);
	own.objects[id].fall = { at: release, v: "hand" };
	const handRest = objectPoseAt(compileSpec(own, { sk: rk, scene: motionScene(kit.records) }).out, id, 79).pos, flight = (hand[1] + Math.sqrt(hand[1] ** 2 + 2 * G * at(release)[1])) / G;
	expect(`${rig}: fall.v "hand" leaves at the hand's velocity: about hand_z x the flight time ahead (within 0.4 m)`, Math.abs(handRest[2] - at(release)[2] - hand[2] * flight) < 0.4, `${handRest[2]} vs ${at(release)[2] + hand[2] * flight}`);
}

// a fall without v: the poses of before (hash pinned from the tree before fall.v), a tilted crate and the ball
{
	const kit = buildKit("ball", [], { position: { x: 0.5, y: 1.4, z: 0.5 } }), id = kit.rootId;
	const crate = { id: "crate", name: "crate", renderer: "cube", x: 1.2, y: 1.0, z: 0.4, rot: 30, rotX: 15, rotZ: 0, scaleX: 0.3, scaleY: 0.2, scaleZ: 0.4, footprint: { width: 1, depth: 1 }, height: 1 };
	const r = compileSpec(spec(60, { [id]: { fall: { at: 5 } }, crate: { fall: { at: 3 } } }), { sk, scene: motionScene([...kit.records, crate]) });
	const poses = Array.from({ length: 60 }, (_, f) => [id, "crate"].map(k => { const p = objectPoseAt(r.out, k, f); return [...p.pos, ...p.R.flat()].map(v => v.toFixed(6)); }));
	const hash = createHash("sha256").update(JSON.stringify(poses)).digest("hex").slice(0, 16);
	expect("a fall without v moves as before (poses hash 8c88f7dadef02674)", hash === "8c88f7dadef02674", hash);
}

// a carry let go with no fall stays where the hand let it go
{
	const far = buildKit("ball", [], { position: { x: 2, y: 1, z: 2 } }), id = far.rootId;
	const s = spec(60, { [id]: { prop: "ballGrip", at: [0, 0, -0.035], along: [0, 1, 0], grab: GRAB, release: 30 } }, { props });
	s.keys = [{ f: 20, set: { armw_r: 1, hand_r: [-0.2, 1.2, 0.35] } }];
	const r = compileSpec(s, { sk, scene: motionScene(far.records) }), a = objectPoseAt(r.out, id, 30).pos, b = objectPoseAt(r.out, id, 59).pos;
	expect("a carry released with no fall stays frozen at its release pose (no implicit fall)", Math.hypot(...a.map((v, i) => v - b[i])) < 1e-9 && a[1] > 0.5, `${a} -> ${b}`);
}

if (failures) { console.log(`${failures} throw check(s) failed`); process.exit(1); }
console.log("motion3 throw: all checks passed");
