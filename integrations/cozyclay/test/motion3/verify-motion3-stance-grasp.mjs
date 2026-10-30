#!/usr/bin/env node
// Grasp round 2, lane stance (session 7f15b4ae: "컵만들고 컵 손으로 잡아봐", then a ball). Pins: a stance in a table
// slides out of it (every cup and ball attempt stood with a foot in the table over the whole take); standIdle with no
// `at` before a reachGrip steps up to the anchor (it was refused); an upright cup under a plain anchor is wrapped from
// the side, not covered from the top with the fingers down along the forearm (the installed take's look).
import assert from "node:assert/strict";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";

const check = (name, fn) => { fn(); console.log(`ok - ${name}`); };
const sk = skeletonFor("y-bot-tpose"), I = sk.index;
const rec = ([id, renderer, parent, x, y, z, sx, sy, sz]) => ({ id, name: id, renderer, ...(parent ? { parent } : {}), x, y, z, rot: 0, rotX: 0, rotZ: 0,
	scaleX: sx, scaleY: sy, scaleZ: sz, footprint: { width: 1, depth: 1 }, height: 1 });
const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0), norm = a => a.map(v => v / Math.hypot(...a));
const flat = (v, n) => sub(v, n.map(x => x * dot(v, n)));

// the session's table and cup (arrange_objects: a 0.7 x 0.75 x 0.5 m table at z 0.5, an 8 x 10 cm cup on it)
const CUP = motionScene([["cube", "cube", null, -0.1, 0, 0.5, 0.7, 0.75, 0.5], ["cylinder", "cylinder", null, -0.2, 0.75, 0.4, 0.08, 0.1, 0.08]].map(rec));
const cupSpec = (anchor, stand) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 77, label: "grab cup", anchors: { cup: anchor },
	use: [{ skill: "standIdle", args: stand, f0: 0 }, { skill: "reachGrip", args: { anchor: "cup", side: "r", reach: 22, hold: 30, release: 14 }, f0: 10 }] });
const feet = r => r.qa.groups.filter(g => g.kind === "COLLIDE" && /^(foot|shin|thigh)_/.test(g.subject));
const root = r => r.out.frames[0].s.P[I.Hips];

check("a stance with a foot in the table slides out of it, the least distance, and says so", () => {
	const r = compileSpec(cupSpec({ kind: "object", object: "cylinder", grasp: "power" }, { at: [0, 0], heading: 0 }), { sk, scene: CUP });
	assert.equal(feet(r).length, 0, JSON.stringify(feet(r)));
	assert.ok(root(r)[2] < 0 && root(r)[2] > -0.05, `${root(r)}`);
	assert.match(r.observations.placed?.[0] ?? "", /moved 0\.0\d m out of a scene body/);
});
check("fix.stance false leaves the stance where the spec put it (QA reports the foot)", () => {
	const r = compileSpec({ ...cupSpec({ kind: "world", p: [-0.2, 0.8, 0.4] }, { at: [0, 0], heading: 0 }), fix: { stance: false } }, { sk, scene: CUP });
	assert.ok(feet(r).length > 0 && r.observations.placed === undefined);
});
check("a stance clear of every body stays exactly where the spec put it", () => {
	const r = compileSpec(cupSpec({ kind: "world", p: [-0.2, 0.8, 0.4] }, { at: [0.5, -1], heading: 0 }), { sk, scene: CUP });
	assert.deepEqual([root(r)[0], root(r)[2]].map(v => +v.toFixed(6)), [0.5, -1]);
	assert.equal(r.observations.placed, undefined);
});
check("standIdle with no at before a reachGrip steps up to the anchor: the reaching shoulder in line, at the table's edge", () => {
	const r = compileSpec(cupSpec({ kind: "world", p: [-0.2, 0.8, 0.4] }, {}), { sk, scene: CUP });
	const sh = r.out.frames[0].s.P[I.RightArm];
	assert.equal(feet(r).length, 0, JSON.stringify(feet(r)));
	assert.ok(Math.abs(sh[0] + 0.2) < 0.03, `shoulder x ${sh[0]}`);
	assert.ok(root(r)[2] > -0.1 && root(r)[2] < 0.25, `root z ${root(r)[2]} (table front at 0.25)`);
	assert.match(r.observations.placed?.[0] ?? "", /within reach of anchor cup/);
});

// the installed take: a world anchor at the cup's centre, the stance the agent found
const plain = compileSpec(cupSpec({ kind: "world", p: [-0.2, 0.8, 0.43] }, { at: [-0.03, 0.08], heading: 0 }),
	{ sk, scene: motionScene([["cube", "cube", null, -0.1, 0, 0.62, 0.7, 0.75, 0.5], ["cylinder", "cylinder", null, -0.2, 0.75, 0.43, 0.08, 0.1, 0.08]].map(rec)) });
check("an upright cup under a plain anchor is wrapped from the side: knuckle line within 45 deg of its axis, fingers not down along the forearm", () => {
	for (const f of [34, 45, 55]) {
		const P = plain.out.frames[f].s.P, d = norm(sub(P[I.RightHandMiddle1], P[I.RightHand])), l = norm(flat(sub(P[I.RightHandIndex1], P[I.RightHandPinky1]), d));
		assert.ok(Math.abs(l[1]) > Math.cos(Math.PI / 4), `f${f} knuckle line ${l.map(v => v.toFixed(2))}`);
		assert.ok(-d[1] < 0.75, `f${f} fingers down ${(-d[1]).toFixed(2)}`);
	}
	assert.ok(!plain.qa.groups.some(g => g.kind === "COLLIDE" && /hand_r x cylinder/.test(g.subject)), JSON.stringify(plain.qa.groups.map(g => g.subject)));
});
