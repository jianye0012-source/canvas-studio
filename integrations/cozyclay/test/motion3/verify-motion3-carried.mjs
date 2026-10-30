#!/usr/bin/env node
// Carried props: spec.objects[id] = { prop, at, along, visible } puts a scene record on a held
// prop every frame (the cigarette between the fingers, the lighter in the other hand), shows it
// only while its visibility channel is on, keeps it out of the collision scene, and leaves the
// car-exit scene at QA 0. C14: keys on the baseball swing of session 294ac65a (the bat leads, the
// hands follow; the bat was stuck at 90 degrees to the forearm).
import { EXITCAR_SPEC, SCENE_OBJECTS, CHARACTER } from "./fixtures/exitcar-scene.mjs";
import { compileMotion } from "../../src/motion3/compiler/compile.js";
import { validateSpec } from "../../src/motion3/compiler/validate.js";
import { runMotionQa } from "../../src/motion3/qa/index.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { bakeTake } from "../../src/motion3/take.js";
import { sceneObjectsAt, sceneObjectTravelMatrixAt, trackShown } from "../../src/object-travel.js";
import { dist, apply, angle, matFromQuat, quatFromMat, mul, axisRot, sub, add, scale, dot, len } from "../../src/motion3/compiler/math.js";
import { takeHash as hashOf } from "./fixtures/take-hash.mjs";
import { SCENE_OBJECTS as BAT_SCENE, CHARACTER as BATTER, SWING_SPEC, SWING_KEYS, INSTALLED_SPEC_ID, BAT } from "./fixtures/bat-swing.mjs";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { specIdOf } from "../../src/motion3/spec-store.js";
import { rootPoseAt } from "../../src/motion3/object-pose.js";
import { propOrigin } from "../../src/motion3/carried.js";
import { KEY_BLEND } from "../../src/motion3/object-keys.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const cube = (id, extra = {}) => ({ id, name: id, renderer: "cylinder", x: 0, y: 0, z: -9, rot: 0, rotX: 0, rotZ: 0, scaleX: 0.01, scaleY: 0.084, scaleZ: 0.01, footprint: { width: 1, depth: 1 }, height: 1, ...extra });
// Parked under the car on purpose: a carried record must not collide where it was authored.
const records = [...SCENE_OBJECTS, cube("Cigarette", { z: 0 }), cube("Lighter", { renderer: "cube", scaleX: 0.02, scaleY: 0.05, scaleZ: 0.012 })];
const spec = structuredClone(EXITCAR_SPEC);
spec.objects = { ...spec.objects,
	Cigarette: { prop: "cig", at: [0, 0, -0.026], along: [0, 0, 1], visible: "cig_vis" },
	Lighter: { prop: "lighter", at: [0.01, -0.014, 0], along: [0, 1, 0], visible: "lit_vis" } };
const sk = skeletonFor(CHARACTER.model), scene = motionScene(records);
let refused = "";
try { validateSpec({ ...spec, objects: { ...spec.objects, Bad: { prop: "pipe", at: [0, 0] } } }, { sk, scene: motionScene([...records, cube("Bad")]) }); } catch (error) { refused = error.message; }
expect("an unknown prop and a bad offset are refused by name", /objects\.Bad\.prop "pipe"/.test(refused) && /objects\.Bad\.at/.test(refused), refused);

const out = compileMotion({ fps: 24, ...spec }, { sk, scene });
const qa = runMotionQa(sk, out, spec);
expect("the scene stays at QA 0 with two carried records", qa.ok && qa.total === 0, JSON.stringify(qa.groups.slice(0, 3)));
const take = bakeTake(sk, out, { position: [0, 0, 0], yaw: 0 });
const cig = take.objects.Cigarette, lit = take.objects.Lighter;
expect("the take carries both records with a visibility track", cig?.vis?.length === 730 && lit?.vis?.length === 730);

// The cigarette's base sits on the filter and its +Y runs to the tip, on every visible frame.
let worst = 0, shown = 0;
for (let f = 0; f < out.frameCount; f++) {
	const d = out.frames[f].diag, props = d.props ?? {};
	if (!cig.vis[f] || !props.cig) continue;
	shown++;
	const base = [cig.pos[f * 3], cig.pos[f * 3 + 1], cig.pos[f * 3 + 2]];
	const [x, y, z, w] = cig.quat.subarray(f * 4, f * 4 + 4);
	const up = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
	const tip = base.map((v, i) => v + up[i] * 0.084);
	worst = Math.max(worst, dist(base, props.cig.filter), dist(tip, props.cig.tip));
}
expect("the cigarette runs from the filter to the tip (< 2 mm) while shown", shown > 100 && worst < 0.002, `${shown} frames, worst ${(worst * 1000).toFixed(2)} mm`);
const firstOn = cig.vis.indexOf(1);
expect("it is hidden in the pocket before the hand takes it out", firstOn > 440 && cig.vis[0] === 0, `first shown f${firstOn}`);
expect("the lighter goes back to the pocket (shown, then hidden again)", lit.vis.indexOf(1) > 0 && lit.vis.lastIndexOf(1) < 729);

// Playback: hidden while the channel is off, on the prop while it is on.
const tracks = new Map(Object.entries(take.objects).map(([id, t]) => [id, { frameCount: 730, ...t }]));
const at = f => sceneObjectsAt(records, f, { frameCount: 730, fps: 24, objectTracks: tracks }).find(o => o.id === "Cigarette");
expect("playback hides the cigarette before it is taken out", at(0).hidden === true);
const f5 = firstOn + 5, take5 = { frameCount: 730, fps: 24, objectTracks: tracks };
const m = sceneObjectTravelMatrixAt(records, "Cigarette", f5, take5);
expect("the renderer shows it on the hand once taken out", at(f5).hidden !== true && trackShown("Cigarette", f5, take5) && !trackShown("Cigarette", 0, take5)
	&& dist([m.elements[12], m.elements[13], m.elements[14]], Array.from(cig.pos.subarray(f5 * 3, f5 * 3 + 3))) < 1e-6);
void apply;

// ---- C14: the bat keyed at four frames ------------------------------------------------------
const bsk = skeletonFor(BATTER.model), bscene = motionScene(BAT_SCENE), I = bsk.index;
// lane Q1's carry with fix.self off: the self fix (elbows turned out of the body) is verify-motion3-self's
const keyedSpec = keys => { const sp = structuredClone(SWING_SPEC); sp.objects[BAT].keys = keys; sp.fix = { ...(sp.fix ?? {}), self: false }; return sp; };
const plain = compileSpec({ ...SWING_SPEC, fix: { ...(SWING_SPEC.fix ?? {}), self: false } }, { sk: bsk, scene: bscene }), keyed = compileSpec(keyedSpec(SWING_KEYS), { sk: bsk, scene: bscene });
const col = (R, i) => [R[0][i], R[1][i], R[2][i]], batY = (r, f) => col(rootPoseAt(r.out, BAT, f).R, 1);
const forearm = (r, f) => sub(r.out.frames[f].s.P[I.RightHand], r.out.frames[f].s.P[I.RightForeArm]);
const span = (r, a, b) => { const v = []; for (let f = a; f <= b; f++) v.push(angle(batY(r, f), forearm(r, f))); return Math.max(...v) - Math.min(...v); };
expect("the fixture is the installed take's spec (spec-3a5803641a71)", specIdOf(SWING_SPEC) === INSTALLED_SPEC_ID);
expect("without keys the bat holds one angle to the right forearm all swing (the defect)", span(plain, 34, 81) < 0.01, `${span(plain, 34, 81)}`);
expect("without keys the take is bit for bit the take of lane Q1 (L2's soles on the floor and back foot pivoting on its ball; a flat foot keeps its heading until it lifts)", hashOf(bakeTake(bsk, plain.out)) === "7e49b1630982dfc8", hashOf(bakeTake(bsk, plain.out)));
expect("keyed: the angle between bat and forearm varies through the swing (>= 30 deg)", span(keyed, 40, 53) >= 30, `${span(keyed, 40, 53).toFixed(1)} deg`);
let hit = 0;
for (const k of SWING_KEYS) { const p = rootPoseAt(keyed.out, BAT, k.f), R = matFromQuat(k.rot); hit = Math.max(hit, dist(p.pos, k.pos) * 1000, angle(col(R, 1), col(p.R, 1)), angle(col(R, 0), col(p.R, 0))); }
expect("at each key the drawn bat is the keyed pose (<= 1 mm, <= 0.1 deg)", hit <= 0.1, `${hit}`);
let turn = 0, tipPath = 0, gripPath = 0, right = 0, left = 0;
const grip = f => propOrigin(bsk, keyed.out.ctx.spec, keyed.out.frames[f].s, { prop: "batGrip" }), tip = f => keyed.out.frames[f].diag.props.batGrip.tip;
for (let f = 41; f <= 53; f++) { turn += angle(batY(keyed, f - 1), batY(keyed, f)); tipPath += dist(tip(f), tip(f - 1)); gripPath += dist(grip(f), grip(f - 1)); }
expect("the tip swings around the grip: the bat turns >= 170 deg over f40-f53, the tip travels >= 2.4x the grip", turn >= 170 && tipPath >= 2.4 * gripPath, `${turn.toFixed(1)} deg, ${tipPath.toFixed(2)} / ${gripPath.toFixed(2)} m`);
for (let f = 0; f < 96; f++) {
	const p = rootPoseAt(keyed.out, BAT, f), y = col(p.R, 1), handle = add(p.pos, scale(y, 0.14)), lg = keyed.out.frames[f].diag.props.lGrip.fingers, t = dot(sub(lg, p.pos), y);
	right = Math.max(right, dist(grip(f), handle)); left = Math.max(left, len(sub(sub(lg, p.pos), scale(y, t))) + (t < 0 || t > 0.3 ? 1 : 0));
}
expect("both hands stay on the handle: the right grip on its point (<= 1 mm), the left fingers on the bat axis within 0.3 m of the knob (<= 5 mm)", right <= 0.001 && left <= 0.005, `${(right * 1000).toFixed(2)} / ${(left * 1000).toFixed(2)} mm`);
const tp = bakeTake(bsk, plain.out), tk = bakeTake(bsk, keyed.out), B = tp.bones.length, a = SWING_KEYS[0].f - KEY_BLEND, b = SWING_KEYS[3].f + KEY_BLEND;
const same = f => tp.rot.subarray(f * B * 4, (f + 1) * B * 4).every((v, i) => v === tk.rot[f * B * 4 + i]) && [0, 1, 2].every(i => tp.objects[BAT].pos[f * 3 + i] === tk.objects[BAT].pos[f * 3 + i]);
const differ = Array.from({ length: 96 }, (_, f) => f).filter(f => !same(f));
expect(`the hands blend in and out over ${KEY_BLEND} frames: only f${a + 1}..f${b - 1} change, and QA finds no pop`, differ[0] === a + 1 && differ[differ.length - 1] === b - 1 && !keyed.qa.groups.some(g => g.kind === "POP"),
	`${differ[0]}..${differ[differ.length - 1]} ${keyed.qa.groups.map(g => g.kind)}`);
// BODY (arms in the body, on the skin) is measured on both swings and is verify-motion3-self's subject
// WRIST: the keyed swing bends the left wrist past its ulnar limit at the contact (pinned on its own)
const notBody = r => r.qa.groups.filter(g => g.kind !== "BODY" && g.kind !== "WRIST"), lw = keyed.qa.groups.filter(g => g.kind === "WRIST");
expect("the keyed swing adds no QA issue but BODY and WRIST (the stance goal and the stride float were there before)", notBody(keyed).reduce((n, g) => n + g.count, 0) === notBody(plain).reduce((n, g) => n + g.count, 0) && keyed.qa.groups.every(g => g.kind !== "REACH"), keyed.qa.groups.map(g => `${g.kind} ${g.subject}`).join(" | "));
expect("WRIST: the keyed swing bends the left wrist 40 deg ulnar (limit 35), the plain swing does not", lw.length === 1 && /^hand_l ulnar deviation 40deg \(limit 35\)$/.test(lw[0].subject) && !plain.qa.groups.some(g => g.kind === "WRIST"), JSON.stringify([lw, plain.qa.groups.map(g => g.subject)]));
expect("deterministic: the same keys bake the same take", hashOf(tk) === hashOf(bakeTake(bsk, compileSpec(keyedSpec(SWING_KEYS), { sk: bsk, scene: bscene }).out)));
// a key the wrist cannot reach: the contact pose turned a further 110 deg about the forearm
const R47 = matFromQuat(SWING_KEYS[2].rot), turned = mul(axisRot(forearm(keyed, 47), 110), R47), knob = add(SWING_KEYS[2].pos, apply(R47, [0, 0.14, 0]));
const far = SWING_KEYS.map((k, i) => (i === 2 ? { f: 47, pos: sub(knob, apply(turned, [0, 0.14, 0])), rot: quatFromMat(turned) } : k));
const missed = compileSpec(keyedSpec(far), { sk: bsk, scene: bscene }), reach = missed.qa.groups.find(g => g.kind === "REACH");
expect("QA reports what the wrist cannot reach: REACH \"cylinder: n cm off its keys\", caused by keys[2], the hint names the wrist limit", /^cylinder: [\d.]+ cm off its keys$/.test(reach?.subject)
	&& reach.worst > 0.05 && reach.cause === "objects.cylinder.keys[2] f47" && /the wrist .* needs -?\d+deg \(limit/.test(reach.hint) && !missed.qa.ok, JSON.stringify(reach));

// a release on the last key (or 2 frames after it): both hands ease out of the keys over KEY_BLEND frames past it, so the
// arms do not snap to their plain pose at the release (they did: forearms 10-39 cm/f^2 in one frame, QA POP)
for (const release of [53, 55]) {
	const sp = keyedSpec(SWING_KEYS);
	sp.objects[BAT].release = release;
	const r = compileSpec(sp, { sk: bsk, scene: bscene }), P = (f, j) => r.out.frames[f].s.P[I[j]];
	const acc = j => Math.max(...[0, 1, 2, 3].map(d => { const f = release + d; return len(sub(add(P(f, j), P(f - 2, j)), scale(P(f - 1, j), 2))); }));
	expect(`a release at f${release} (last key f53): no pop, the forearms ease out (<= 6 cm/f^2)`, !r.qa.groups.some(g => g.kind === "POP") && acc("RightForeArm") <= 0.06 && acc("LeftForeArm") <= 0.06,
		`${r.qa.groups.filter(g => g.kind === "POP").map(g => g.subject)} ${(acc("RightForeArm") * 100).toFixed(1)} ${(acc("LeftForeArm") * 100).toFixed(1)}`);
}

if (failures) { console.error(`${failures} carried-prop check(s) failed`); process.exit(1); }
console.log("motion3 carried props: all checks passed");
