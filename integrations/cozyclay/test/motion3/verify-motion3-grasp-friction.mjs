#!/usr/bin/env node
// Grasp round 2, lane friction: what got in the agent's way when it held things (sessions 2ad2760a, 7f15b4ae).
//   E  a steering wheel (a disc) is a rim socket: two hands with grasp take the rim nearest their shoulders and stay
//      on that spot as the wheel moves with its truck (2ad2760a held points in the driver's frame, 15 cm off the rim)
//   F  reachGrip holds to the last frame when its hold runs past it (7f15b4ae: "needs 92 frames ... past the last
//      frame f85"); its fingers' prop takes a free name when the spec has a prop <anchor>Grip of its own (7f15b4ae:
//      props.ballGrip for a carry broke reachGrip on anchor "ball"); motion.report takes characterId (2ad2760a)
//   G  a contact sheet's own views ride a focus that travels farther than its size (2ad2760a: the wheel in a driving
//      truck framed from 20 m, the hands too small to read)
import assert from "node:assert/strict";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { objectPoseAt } from "../../src/motion3/object-pose.js";
import { socketsOf } from "../../src/motion3/sockets.js";
import { viewCameras, cameraAt } from "../../src/motion3/views.js";
import { createStudioAppActions } from "../../src/commands/index.js";
import { SCENE_OBJECTS, CHARACTER } from "./fixtures/cup-scene.mjs";

const check = (name, fn) => { fn(); console.log(`ok - ${name}`); };
const sk = skeletonFor("y-bot-tpose"), I = sk.index;
const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0), len = a => Math.hypot(...a), norm = a => a.map(v => v / len(a));
const flat = (v, n) => sub(v, n.map(x => x * dot(v, n))), cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const deg = x => (Math.acos(Math.max(-1, Math.min(1, x))) * 180) / Math.PI;
const rec = o => ({ rot: 0, rotX: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1, footprint: { width: 1, depth: 1 }, height: 1, ...o });

// ---- E: the steering wheel ----------------------------------------------------------------------------------------
// etst's wheel: a cylinder 0.4 m across and 3 cm thick, tilted toward the driver, in a group (the truck) that moves
const WHEEL = [rec({ id: "rig", name: "Truck", renderer: "empty", x: 0, y: 0, z: 0 }),
	rec({ id: "wheel", name: "Steering wheel", renderer: "cylinder", parent: "rig", x: 0, y: 1.12, z: 0.42, rotX: 70, scaleX: 0.4, scaleY: 0.03, scaleZ: 0.4 })];
const wheelScene = motionScene(WHEEL);
const wheelSpec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 150,
	anchors: { wl: { kind: "object", object: "rig", grasp: "power" }, wr: { kind: "object", object: "rig", grasp: "power" } },
	use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } },
		{ skill: "reachGrip", f0: 6, args: { anchor: "wl", side: "l", reach: 20, hold: 123 } }, { skill: "reachGrip", f0: 6, args: { anchor: "wr", side: "r", reach: 20, hold: 123 } }],
	objects: { rig: { keys: [{ f: 0, pos: [0, 0, 0] }, { f: 60, pos: [0, 0, 0] }, { f: 120, pos: [0.06, 0, -0.03] }, { f: 149, pos: [0.06, 0, -0.03] }] } } };
const wheel = compileSpec(wheelSpec, { sk, scene: wheelScene });
const HELD = [30, 60, 90, 120, 149];
/** Hand k at frame f against the wheel: cm off the rim, knuckle line vs the rim's direction (deg), the finger middles in the wheel's axes. */
function onWheel(k, f) {
	const S = k === "l" ? "Left" : "Right", P = wheel.out.frames[f].s.P, pose = objectPoseAt(wheel.out, "wheel", f);
	const n = norm([0, 1, 2].map(i => pose.R[i][1])), c = pose.pos.map((v, i) => v + pose.R[i][1] * 0.015);
	const F = P[I[`${S}HandIndex2`]].map((v, i) => (v + P[I[`${S}HandMiddle2`]][i]) / 2), v = sub(F, c);
	const d = norm(sub(P[I[`${S}HandMiddle1`]], P[I[`${S}Hand`]])), l = norm(flat(sub(P[I[`${S}HandIndex1`]], P[I[`${S}HandPinky1`]]), d));
	return { rimCm: 100 * Math.hypot(dot(v, n), len(flat(v, n)) - 0.2), knuckle: deg(Math.abs(dot(l, norm(cross(n, norm(flat(v, n))))))),
		local: [0, 1, 2].map(i => dot([pose.R[0][i], pose.R[1][i], pose.R[2][i]], sub(F, pose.pos))) };
}
check("a disc (a cylinder 3 cm thick, 0.4 m across) is a rim socket of its group; a can stays a thin-body socket", () => {
	const [rim] = socketsOf(wheelScene, "rig");
	assert.equal(rim.rim, 0.2);
	assert.deepEqual(rim.normal, [0, 1, 0]);
	const can = motionScene([rec({ id: "can", name: "Can", renderer: "cylinder", x: 0, y: 0, z: 0, scaleX: 0.066, scaleY: 0.12, scaleZ: 0.066 })]);
	assert.equal(socketsOf(can, "can")[0].rim, undefined);
});
check("both hands hold the rim (2 cm of it: the finger middles on a 3 cm rim), the knuckle line along it", () => {
	for (const k of ["l", "r"]) for (const f of HELD) {
		const h = onWheel(k, f);
		assert.ok(h.rimCm < 3 && h.knuckle < 25, `${k} f${f} ${JSON.stringify(h)}`);
	}
});
check("each hand keeps its spot on the rim while the truck moves 6 cm (the same point in the wheel's axes to 2 mm)", () => {
	for (const k of ["l", "r"]) {
		const pts = HELD.map(f => onWheel(k, f).local);
		for (const p of pts) assert.ok(len(sub(p, pts[0])) < 0.002, `${k} ${JSON.stringify(pts)}`);
	}
	assert.ok(onWheel("l", 90).local[0] * onWheel("r", 90).local[0] < 0, "the hands take the two sides of the wheel");
});
check("the take is QA clean: the hands may touch the parts of the group they grip", () => assert.equal(wheel.qa.problems, 0, JSON.stringify(wheel.qa.groups.map(g => g.subject))));

// ---- F: reachGrip and motion.report -------------------------------------------------------------------------------
const B = [-0.2, 0.79, 0.45], UP = [-0.17, 1.12, 0.3];
const ballScene = motionScene([rec({ id: "cube", name: "Table", renderer: "cube", x: -0.1, y: 0, z: 0.62, scaleX: 0.7, scaleY: 0.75, scaleZ: 0.5 }),
	rec({ id: "empty", name: "Ball", renderer: "empty", x: -0.2, y: 0.753, z: 0.41 }),
	rec({ id: "sphere", name: "Ball", renderer: "sphere", parent: "empty", x: -0.2, y: 0.753, z: 0.41, scaleX: 0.074, scaleY: 0.074, scaleZ: 0.074 })]);
// session 7f15b4ae's ball specs: its own props.ballGrip for the carry, reachGrip on anchor "ball"
const ballSpec = hold => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 86,
	props: { ballGrip: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { centre: [0, 0, -0.035] } } }, anchors: { ball: { kind: "world", p: B } },
	use: [{ skill: "standIdle", args: { at: [-0.03, 0.08], heading: 0 }, f0: 0 }, { skill: "reachGrip", args: { anchor: "ball", side: "r", reach: 20, hold, release: 12 }, f0: 10 }],
	objects: { empty: { prop: "ballGrip", grab: 30, keys: [{ f: 32, pos: B }, { f: 56, pos: UP }, { f: 84, pos: UP }] } } });
check("a spec prop named <anchor>Grip no longer breaks reachGrip: its fingers take ballGrip_r, the carry keeps the spec's", () => {
	const r = compileSpec(ballSpec(30), { sk, scene: ballScene });
	assert.ok(r.expanded.props.ballGrip_r?.points.fingers && r.expanded.props.ballGrip.points.centre, JSON.stringify(Object.keys(r.expanded.props)));
	assert.ok(r.expanded.fits.some(f => f.effector.prop === "ballGrip_r"));
});
check("a hold past the last frame holds the grip to the end and says so (the session asked hold 60 of an 86-frame take)", () => {
	const r = compileSpec(ballSpec(60), { sk, scene: ballScene }), use = r.used.find(u => u.skill === "reachGrip");
	assert.equal(use.cut, "hold cut at f85 (hold to the end)");
	assert.ok(r.out.frames[85].c.w_ball_r > 0.99, `${r.out.frames[85].c.w_ball_r}`);
});
check("the same anchor reached again by the same hand keeps one prop name", () => {
	const s = ballSpec(10);
	s.props = {};
	s.use.push({ skill: "reachGrip", args: { anchor: "ball", side: "r", reach: 10, hold: 5, release: 8 }, f0: 60 });
	delete s.objects;
	assert.deepEqual(Object.keys(compileSpec(s, { sk, scene: ballScene }).expanded.props), ["ballGrip"]);
});
check("motion.report takes characterId: the installed take's groups, without a specId", () => {
	const takes = new Map(), owner = { replace: (cid, take) => takes.set(cid, take), motionFor: cid => takes.get(cid) ?? null };
	const ports = { state: () => ({ characters: [CHARACTER], objects: SCENE_OBJECTS, frameCount: 800 }), storeDomain: name => (name === "motion" ? owner : null) };
	const reg = createStudioAppActions(ports), reg2 = createStudioAppActions(ports);
	const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 24, use: [{ skill: "standIdle", args: { at: [0, 0], heading: 0 }, f0: 0 }],
		anchors: { far: { kind: "world", p: [0.2, 1, 1.5] } }, checks: { contacts: [{ name: "rh", point: "joint:RightHand", target: "anchor:far" }] } };
	const compiled = reg.run("motion.compile", { characterId: CHARACTER.id, spec, install: true }).output;
	const page = reg.run("motion.report", { characterId: CHARACTER.id }).output;
	assert.equal(page.specId, compiled.specId);
	assert.ok(page.items.length > 0 && page.items[0].kind === compiled.qa.groups[0].kind, JSON.stringify(page).slice(0, 300));
	// another editor session never compiled it: the take's QA runs now
	assert.equal(reg2.run("motion.report", { characterId: CHARACTER.id }).output.items.length, page.items.length);
	assert.throws(() => reg.run("motion.report", {}), /needs specId .* or characterId/);
});

// ---- G: views ride a travelling focus -----------------------------------------------------------------------------
check("a view framed on a wheel that drives 12 m rides with it, 1.2 m off, where one camera for the drive stood 20 m off", () => {
	const scene = motionScene(WHEEL), drive = compileSpec({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 150, use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } }],
		objects: { rig: { keys: [{ f: 0, pos: [0, 0, 0] }, { f: 149, pos: [0, 0, 12] }] } } }, { sk, scene });
	const frames = [20, 60, 100, 140], cams = viewCameras(drive.out, { views: ["side", "three-quarter"], frames, focus: ["object:wheel"] });
	for (const cam of cams) for (const f of frames) {
		const at = cameraAt(cam, f), wheelAt = objectPoseAt(drive.out, "wheel", f).pos;
		assert.ok(cam.ride && len(sub(at.eye, wheelAt)) < 2, `${cam.name} f${f} ${len(sub(at.eye, wheelAt))}`);
	}
	// a focus that stays put keeps one camera for every frame (as before)
	const still = viewCameras(wheel.out, { views: ["side"], frames, focus: ["object:wheel"] });
	assert.equal(still[0].ride, undefined);
});
