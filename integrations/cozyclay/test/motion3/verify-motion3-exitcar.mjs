#!/usr/bin/env node
// P6 acceptance: the car-exit + smoking scene (fixtures/exitcar-scene.mjs) compiles on the X Bot
// at 24 fps with QA = 0 issues, through the same path motion.compile uses, and every declared
// contact (door handle grip, seat support, filter on the lips, flame under the tip) really holds.
import { EXITCAR_SPEC, SCENE_OBJECTS, CHARACTER } from "./fixtures/exitcar-scene.mjs";
import { compileMotion } from "../../src/motion3/compiler/compile.js";
import { resolveAnchor } from "../../src/motion3/compiler/anchors.js";
import { runMotionQa } from "../../src/motion3/qa/index.js";
import { CAPSULES, segPoints, sdBox } from "../../src/motion3/qa/geometry.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { bakeTake } from "../../src/motion3/take.js";
import { dist } from "../../src/motion3/compiler/math.js";
import { budgetMs } from "./fixtures/time-budget.mjs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}

const spec = JSON.parse(JSON.stringify(EXITCAR_SPEC));
expect("the spec is plain JSON", JSON.stringify(spec) === JSON.stringify(EXITCAR_SPEC));
const sk = skeletonFor(CHARACTER.model);
// CPU time of the main thread, not wall time: tools/run-tests.mjs runs files in parallel, and the
// wall clock then counts the other files' load (3.0 s under the suite, 1.4 s alone; #810). The
// compile and QA run on this thread; V8's GC and JIT helper threads are left out.
const cpuMs = since => { const { user, system } = process.threadCpuUsage(since); return (user + system) / 1000; };
let t0 = process.threadCpuUsage();
const out = compileMotion({ fps: 24, ...spec }, { sk, scene: motionScene(SCENE_OBJECTS) });
const compileMs = cpuMs(t0);
t0 = process.threadCpuUsage();
const qa = runMotionQa(sk, out, spec);
const qaMs = cpuMs(t0);
console.log(`compiled ${out.frameCount} frames in ${compileMs.toFixed(0)} ms CPU, QA in ${qaMs.toFixed(0)} ms CPU: ${qa.total} issues in ${qa.groups.length} groups`);
for (const g of qa.groups) console.log(`  [${g.count}] ${g.kind} ${g.subject} f${g.first}-${g.last} worst ${g.worst} @${g.worstFrame} (limit ${g.limit})`);
expect("730 frames at 24 fps", out.frameCount === 730 && out.fps === 24);
// QA WRIST (qa/wrist-checks.js) is clear too: fix.self's elbow turn stops the smoking wrist at its limit (compiler/wrist-clamp.js)
expect("QA reports 0 issues", qa.ok && qa.total === 0, `${qa.total} issues ${JSON.stringify(qa.groups.slice(0, 2))}`);
expect("compile + QA stay fast (< 3 s CPU)", compileMs + qaMs < budgetMs(3000), `${(compileMs + qaMs).toFixed(0)} ms CPU`);

// Each declared contact: active on enough frames, and within its tolerance on every one of them.
function contact(name, active, a, b, tol, minFrames) {
	let n = 0, worst = 0;
	for (let f = 0; f < out.frameCount; f++) {
		if (!active(out.frames[f])) continue;
		n += 1;
		worst = Math.max(worst, dist(a(out.frames[f]), b(out.frames[f])));
	}
	console.log(`  ${name}: ${n} frames, worst ${(worst * 100).toFixed(2)} cm (tol ${(tol * 100).toFixed(1)} cm)`);
	expect(`${name} holds on ${minFrames}+ frames`, n >= minFrames && worst <= tol, `${n} frames, worst ${worst}`);
}
const anchor = (fr, name) => resolveAnchor(out.ctx, name, fr.s, fr.diag, fr.c);
contact("fingers on the door handle", fr => fr.c.w_handle_l > 0.99, fr => fr.diag.props.grip.fingers, fr => anchor(fr, "handle"), 0.04, 20);
contact("filter on the lips", fr => fr.c.w_mouth_r > 0.99 && fr.c.cig_vis > 0.5, fr => fr.diag.props.cig.filter, fr => anchor(fr, "mouth"), 0.01, 40);
contact("flame under the cigarette tip", fr => fr.c.flame_vis > 0.5 && fr.c.lit_vis > 0.5, fr => fr.diag.props.lighter.flame, fr => anchor(fr, "flame"), 0.01, 10);

// The handle the fingers hold moves with the door while it is pulled open.
const gripped = out.frames.flatMap((fr, f) => (fr.c.w_handle_l > 0.99 ? [out.objectsAt(f).Car_Door_L.angle] : []));
expect("the door turns while the hand grips it", Math.min(...gripped) <= -9.5 && Math.max(...gripped) >= -0.5, JSON.stringify([Math.min(...gripped), Math.max(...gripped)]));
expect("the door ends open at -68 deg", Math.abs(out.objectsAt(729).Car_Door_L.angle + 68) < 1e-9);

// Seat support: until the swivel ends the hips capsule rests on the driver seat (within 4 cm).
const hips = CAPSULES.find(c => c[0] === "hips"), I = sk.index;
let seatWorst = 0;
for (let f = 0; f <= 150; f++) {
	const P = out.frames[f].s.P, seat = out.objectsAt(f).Car_Seat_Driver;
	seatWorst = Math.max(seatWorst, Math.abs(Math.min(...segPoints(P[I[hips[1]]], P[I[hips[2]]]).map(p => sdBox(p, seat))) - hips[3]));
}
console.log(`  seat support f0-150: hips capsule within ${(seatWorst * 100).toFixed(2)} cm of the seat`);
expect("the hips rest on the seat while seated (f0-150)", seatWorst <= 0.04, seatWorst);
const standing = out.frames[260].s.P[I.Hips];
expect("standing away from the car after the exit", standing[0] > 1.5 && standing[1] > 0.95);
const smokeAt = out.frames[505].s.P[I.Hips];
expect("smoking after the walk, clear of the car", smokeAt[0] > 3 && smokeAt[2] < -2.5, JSON.stringify(smokeAt));

const take = bakeTake(sk, out, { position: [CHARACTER.x, CHARACTER.y, CHARACTER.z], yaw: CHARACTER.rot }, { spec });
expect("the take carries the door and handle tracks", take.objects.Car_Door_L?.pos.length === 730 * 3 && take.objects.Car_Door_Handle?.quat.length === 730 * 4);

if (failures) { console.error(`${failures} motion3 exitcar check(s) failed`); process.exit(1); }
console.log("motion3 exitcar: all checks passed");
