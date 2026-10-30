#!/usr/bin/env node
// Physical grasp (#816), fingers in contact: a hand that takes a can by its socket closes each finger until it touches
// the can's round side, on both rigs, instead of curling a preset angle into it or short of it. fix.grasp false is the
// take of before (its hash pinned from the tree before the fingers closed), and the same spec bakes the same take.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { bakeTake } from "../../src/motion3/take.js";
import { graspChecks, heldSpans } from "../../src/motion3/qa/grasp-checks.js";
import { takeHash } from "./fixtures/take-hash.mjs";
import { CAN_SCENE, canGripSpec } from "./fixtures/can-grip.mjs";
import { BALL_SCENE, BALL, ballPickupSpec, MODEL } from "./fixtures/ball-pickup.mjs";
import { objectPoseAt } from "../../src/motion3/object-pose.js";
import { ball as ballKit } from "../../src/kits/held.js";
import { propOrigin } from "../../src/motion3/carried.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` - ${detail}`}`);
	if (!condition) failures += 1;
}
// the takes with fix.grasp false as the tree before the fingers closed baked them (commit 618c9e82)
const BEFORE = { "y-bot-tpose": "ad8cd7187dec594e", "x-bot-tpose": "3a5be06e534c2477" };
const scene = motionScene(CAN_SCENE);
for (const model of ["y-bot-tpose", "x-bot-tpose"]) {
	const sk = skeletonFor(model), on = compileSpec(canGripSpec(), { sk, scene }), off = compileSpec(canGripSpec({ grasp: false }), { sk, scene });
	const issues = graspChecks(sk, on.out), kinds = k => issues.filter(i => i.kind === k);
	console.log(`  ${model}: closed at f30 ${JSON.stringify(on.out.frames[30].diag.closed_r)}`);
	expect(`${model}: no phalanx goes into the can`, kinds("FINGER_PEN").length === 0, JSON.stringify(kinds("FINGER_PEN").slice(0, 3)));
	expect(`${model}: three fingertips or more on the can on every holding frame`, kinds("FINGER_GAP").length === 0, JSON.stringify(kinds("FINGER_GAP").slice(0, 3)));
	const offIssues = graspChecks(sk, { ...off.out, ctx: { ...off.out.ctx, spec: { ...off.out.ctx.spec, fix: undefined } } });
	expect(`${model}: the preset grip of before sinks into the can or stops short of it`, offIssues.some(i => i.kind === "FINGER_PEN" || i.kind === "FINGER_GAP"), offIssues.length);
	expect(`${model}: fix.grasp false bakes the take of before`, takeHash(bakeTake(sk, off.out)) === BEFORE[model], takeHash(bakeTake(sk, off.out)));
	expect(`${model}: the same spec bakes the same take`, takeHash(bakeTake(sk, on.out)) === takeHash(bakeTake(sk, compileSpec(canGripSpec(), { sk, scene }).out)));
}

// the session's ball (#816, task 5): it rests in the hand and settles in on the grab
{
	const sk = skeletonFor(MODEL), ballScene = motionScene(BALL_SCENE), r = compileSpec(ballPickupSpec(), { sk, scene: ballScene });
	const issues = graspChecks(sk, r.out), I = sk.index, pos = f => objectPoseAt(r.out, BALL, f).pos, d = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
	expect("ball: no phalanx in it, three fingertips or the thumb and two on it, supported, from the settle on", issues.length === 0, JSON.stringify(issues.slice(0, 3)));
	expect("ball: still before the grab (f0..f29 within 0.1 mm)", [...Array(30).keys()].every(f => d(pos(f), pos(0)) < 1e-4), d(pos(29), pos(0)));
	const step = f => d(pos(f + 1), pos(f)), hand = f => d(r.out.frames[f + 1].s.P[I.RightHand], r.out.frames[f].s.P[I.RightHand]);
	expect("ball: over f30..f34 it moves no faster than 3x the hand plus 1 cm a frame (no snap)", [30, 31, 32, 33].every(f => step(f) <= 3 * hand(f) + 0.01), [30, 31, 32, 33].map(step).join());
	const palm = f => { const P = r.out.frames[f].s.P; return P[I.RightHand].map((v, i) => (v + P[I.RightHandMiddle1][i]) / 2); };
	// seated against the knuckles, the fingers round it (a 7.4 cm ball sits about 9 cm out from the palm's middle)
	expect("ball: its centre stays within the hand (10 cm of the palm's middle) while held (f40..f85)", [40, 50, 60, 70, 85].every(f => d(pos(f), palm(f)) < 0.1), [40, 60, 85].map(f => d(pos(f), palm(f)).toFixed(3)).join());
	expect("ball: no GRAB and no REACH off its keys", !r.qa.groups.some(g => g.kind === "GRAB" || (g.kind === "REACH" && /off its keys/.test(g.subject))), r.qa.groups.map(g => g.kind).join());
}

// the ball kit (#816, task 6): its carry as the kit gives it, picked up with reachGrip on an anchor named after its prop
// (reachGrip's ballGrip, the test writes no props); and the old kit literal for contrast (a knuckle point 3.5 cm out)
{
	const sk = skeletonFor(MODEL), ballScene = motionScene(BALL_SCENE), { props: _p, ...plain } = ballPickupSpec();
	const kitSpec = carry => ({ ...plain, anchors: { ball: plain.anchors.orb }, use: plain.use.map(u => (u.skill === "reachGrip" ? { ...u, args: { ...u.args, anchor: "ball" } } : u)),
		objects: { [BALL]: { ...carry, grab: 30, keys: plain.objects[BALL].keys } } });
	const now = compileSpec(kitSpec(ballKit.carry), { sk, scene: ballScene }), issues = graspChecks(sk, now.out);
	expect("ball kit: picked up from its kit carry, judged as a held ball, no FINGER_PEN, FINGER_GAP or SUPPORT", heldSpans(now.out).some(h => h.id === BALL && h.grasp === "spherical") && issues.length === 0 && !now.qa.groups.some(g => /^(FINGER_PEN|FINGER_GAP|SUPPORT)$/.test(g.kind)), JSON.stringify(issues.slice(0, 3)));
	const old = compileSpec(kitSpec({ prop: "ballGrip", at: [0, 0, -0.035], along: [0, 1, 0] }), { sk, scene: ballScene });
	const off = [40, 60].map(f => Math.hypot(...objectPoseAt(old.out, BALL, f).pos.map((v, i) => v - propOrigin(sk, old.out.ctx.spec, old.out.frames[f].s, old.out.ctx.spec.objects[BALL])[i])));
	expect("old ball kit literal: the ball centre rides 0.035 m off the finger middles (the knuckle point)", off.every(d => Math.abs(d - 0.035) < 0.002), off.map(d => d.toFixed(4)).join());
}

if (failures) { console.log(`${failures} finger contact check(s) failed`); process.exit(1); }
console.log("motion3 finger contact: all checks passed");
