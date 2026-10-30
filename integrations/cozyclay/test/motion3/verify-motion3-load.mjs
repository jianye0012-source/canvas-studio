#!/usr/bin/env node
// Physical grasp (#816), load: what a hand carries weighs on its arm. A box held out on a plain hand target sags the
// wrist by its weight and bends the elbow more; past one hand's load QA says LOAD, and for a right-hand carry its patch
// adds the left hand; a keyed carry reports its load and keeps its keys; a 0.15 kg ball changes nothing.
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { bakeTake } from "../../src/motion3/take.js";
import { applyPatch } from "../../src/motion3/json-patch.js";
import { signedDistance } from "../../src/motion3/shapes.js";
import { takeHash } from "./fixtures/take-hash.mjs";
import { BALL_SCENE, BALL, ballPickupSpec, MODEL } from "./fixtures/ball-pickup.mjs";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` - ${detail}`}`);
	if (!condition) failures += 1;
}
const sk = skeletonFor(MODEL), I = sk.index, GRAB = 20, FRAMES = 60, SIZE = 0.4;
const rec = (id, x, y, z, s) => ({ id, name: id, renderer: "cube", x, y, z, rot: 0, rotX: 0, rotZ: 0, scaleX: s, scaleY: s, scaleZ: s, footprint: { width: 1, depth: 1 }, height: 1 });
const S = k => (k === "l" ? "Left" : "Right");
/** A box carried by hand k from GRAB, the hand on a plain target at `at` (or led by keys), placed under the palm at the grab. */
function boxSpec(k, at, mass, keyed = false) {
	const target = k === "r" ? at : [-at[0], at[1], at[2]];
	const spec = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: FRAMES,
		props: { boxGrip: { hand: k, origin: [`${S(k)}HandIndex2`, `${S(k)}HandMiddle2`], points: {} } },
		use: [{ skill: "standIdle", args: { at: [0, 0], heading: 0 }, f0: 0 }],
		keys: keyed ? [] : [{ f: 0, set: { [`armw_${k}`]: 0 } }, { f: 12, set: { [`armw_${k}`]: 1, [`hand_${k}`]: target } }],
		objects: { box: { prop: "boxGrip", grab: GRAB, ...(mass === undefined ? {} : { mass }) } } };
	return spec;
}
/** The box's scene under hand k's palm at the grab of spec (compiled once without the box's weight). */
function sceneFor(spec, k) {
	const probe = compileSpec({ ...spec, objects: {}, props: {} }, { sk, scene: motionScene([]) }), P = probe.out.frames[GRAB].s.P;
	const palm = P[I[`${S(k)}HandMiddle1`]].map((v, i) => (v + P[I[`${S(k)}Hand`]][i]) / 2);
	return motionScene([rec("box", palm[0], palm[1] - SIZE / 2 - 0.03, palm[2] + SIZE / 2 - 0.02, SIZE)]);
}
const run = (spec, scene) => compileSpec(spec, { sk, scene });
const groups = (r, kind) => r.qa.groups.filter(g => g.kind === kind);
const held = r => r.observations.load ?? {};

// 12 kg held out in front by the right hand on a plain target (both arms can reach the box: the patch's left hand too)
const OUT = [-0.12, 1.12, 0.36];
const outR = boxSpec("r", OUT, 12), sceneR = sceneFor(outR, "r"), heavyR = run(outR, sceneR), loadR = groups(heavyR, "LOAD")[0];
expect("12 kg held out in front (right hand): LOAD with a patch", !!loadR?.patch, JSON.stringify(loadR));
const outL = boxSpec("l", OUT, 12), heavyL = run(outL, sceneFor(outL, "l")), loadL = groups(heavyL, "LOAD")[0];
expect("12 kg held by the left hand: LOAD, a hint naming the right hand, no patch", !!loadL && !loadL.patch && /right hand/.test(loadL.hint ?? ""), JSON.stringify(loadL));
// keyed: the box's keys lead the right hand from the grab
const keyedSpec = boxSpec("r", OUT, 12, true), box0 = sceneR.objects.box.pos;
keyedSpec.objects.box.keys = [{ f: GRAB, pos: box0 }, { f: 40, pos: [box0[0], box0[1] + 0.05, box0[2] - 0.08] }];
keyedSpec.keys = [{ f: 0, set: { armw_r: 0 } }, { f: 12, set: { armw_r: 1, hand_r: OUT } }];
const keyed = run(keyedSpec, sceneR);
expect("12 kg keyed carry: observations.load and LOAD", !!held(keyed).hand_r && groups(keyed, "LOAD").length > 0, JSON.stringify(held(keyed)));
expect("12 kg keyed carry: the wrist follows the keys (no REACH off its keys)", !keyed.qa.groups.some(g => g.kind === "REACH" && /off its keys/.test(g.subject)), keyed.qa.groups.map(g => g.subject).join(" | "));
// the patch: the left hand on the face opposite the right palm
const patched = applyPatch(outR, loadR?.patch ?? []), two = run(patched, sceneR), F = 45;
const boxAt = two.out.ctx.objectsAt(F).box ?? null, leftGap = boxAt ? signedDistance({ ...sceneR.objects.box, ...boxAt }, two.out.frames[F].s.P[I.LeftHandMiddle1]) : Infinity;
expect("the patched spec has no LOAD", groups(two, "LOAD").length === 0, groups(two, "LOAD").map(g => g.subject).join());
expect(`the patched spec's left hand is on the box (within 0.03 m at f${F})`, leftGap < 0.03, leftGap.toFixed(3));

// 5 kg on a plain target nearer the body: the wrist sags 0.03 m and the elbow bends more than with 0.02 kg
const mid = [-0.22, 1.1, 0.38], five = boxSpec("r", mid, 5), light = boxSpec("r", mid, 0.02), sceneM = sceneFor(five, "r");
const r5 = run(five, sceneM), r0 = run(light, sceneM), wristY = (r, f) => r.out.frames[f].s.P[I.RightHand][1];
const settled = [30, 40, 50], drops = settled.map(f => wristY(r0, f) - wristY(r5, f));
expect("5 kg lowers the wrist by 0.03 +- 0.002 m once settled", drops.every(d => Math.abs(d - 0.03) <= 0.002), drops.map(d => d.toFixed(4)).join());
const flex = (r, f) => { const P = r.out.frames[f].s.P, a = P[I.RightArm], b = P[I.RightForeArm], c = P[I.RightHand], u = b.map((v, i) => v - a[i]), v = c.map((x, i) => x - b[i]);
	return (Math.acos(Math.max(-1, Math.min(1, u.reduce((s, x, i) => s + x * v[i], 0) / Math.hypot(...u) / Math.hypot(...v)))) * 180) / Math.PI; };
const more = Array.from({ length: FRAMES - 2 - GRAB }, (_, i) => GRAB + 1 + i).map(f => [f, flex(r5, f) - flex(r0, f)]);
console.log(`  5 kg elbow flex over 0.02 kg: f${more[0][0]}-f${more[3][0]} ${more.slice(0, 4).map(x => x[1].toFixed(1)).join(" ")} .. f${more.at(-1)[0]} ${more.at(-1)[1].toFixed(1)} deg`);
expect("5 kg bends the elbow more than 0.02 kg on every held frame", more.every(([, d]) => d > 0), JSON.stringify(more.filter(([, d]) => !(d > 0)).slice(0, 4)));

// the ball: 0.15 kg changes nothing
const ballScene = motionScene(BALL_SCENE), plain = ballPickupSpec(), weighed = structuredClone(plain);
weighed.objects[BALL].mass = 0.15;
const ballR = run(plain, ballScene);
expect("the ball's take is the same with and without its 0.15 kg", takeHash(bakeTake(sk, ballR.out)) === takeHash(bakeTake(sk, run(weighed, ballScene).out)));

// observations.load: every hand that carries, its held span; none for a hand that holds nothing
const span = (r, id) => { const o = r.spec.objects[id]; return [o.grab ?? 0, o.release ?? r.out.frameCount - 1]; };
for (const [name, r, k, id] of [["ball", ballR, "r", BALL], ["5 kg box", r5, "r", "box"], ["12 kg box", heavyR, "r", "box"], ["patched two-hand box", two, "r", "box"]]) {
	const row = held(r)[`hand_${k}`], other = held(r)[`hand_${k === "r" ? "l" : "r"}`];
	expect(`${name}: observations.load.hand_${k} has mass, maxNm and its held frames; the free hand has no entry`, !!row && row.mass > 0 && row.maxNm > 0 && JSON.stringify(row.frames) === JSON.stringify(span(r, id)) && !other, JSON.stringify(held(r)));
}

if (failures) { console.log(`${failures} load check(s) failed`); process.exit(1); }
console.log("motion3 load: all checks passed");
