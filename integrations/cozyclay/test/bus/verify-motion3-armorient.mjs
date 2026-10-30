#!/usr/bin/env node
// Lane K8 (docs/motion-api-v3.1.md C14, C16): the arm, not the wrist alone, turns a held object.
// The elbow swings about the shoulder-wrist axis and the forearm turns about its own axis before
// the wrist adds the rest; an aim key without roll takes the roll the arm holds most easily; a
// left hand anchored to the bat turns with it. Measured on two real Studio agent runs of the same
// request (test/motion3/fixtures/bat-aim-swing.mjs) and the J2 swing (bat-swing.mjs):
//   session 16d12ba9 (aim keys)  installed at QA 115, REACH "empty: 77.0 cm off its keys"
//   session 6912547c (rot keys)  installed at QA 35, REACH 12.0 cm, FLIP 107 deg
import { takeHash as hashOf } from "../motion3/fixtures/take-hash.mjs";
import { SWING_SPEC, SWING_SPEC_ID, EARLIER_SPEC, EARLIER_SPEC_ID, SWING_KIT_AT, EARLIER_KIT_AT, BAT, CHARACTER, batKit } from "../motion3/fixtures/bat-aim-swing.mjs";
import * as J2 from "../motion3/fixtures/bat-swing.mjs";
import { compileSpec } from "../motion3/fixtures/legacy-compile.mjs";
import { solveFrame } from "../../src/motion3/compiler/compile.js";
import { channelsAt } from "../../src/motion3/compiler/channels.js";
import { palmAxes } from "../../src/motion3/compiler/limbs.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { specIdOf } from "../../src/motion3/spec-store.js";
import { bakeTake } from "../../src/motion3/take.js";
import { rootPoseAt } from "../../src/motion3/object-pose.js";
import { add, sub, scale, dist, angle, cross, len, norm } from "../../src/motion3/compiler/math.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const sk = skeletonFor(CHARACTER.model), I = sk.index;
const kinds = r => r.qa.groups.map(g => `${g.kind} ${g.subject} f${g.first}-${g.last}`);
const batReach = r => r.qa.groups.find(g => g.kind === "REACH" && /off its keys$/.test(g.subject));
const cm = g => +(/: ([\d.]+) cm off its keys$/.exec(g?.subject ?? "")?.[1] ?? 0);
const yOf = p => [p.R[0][1], p.R[1][1], p.R[2][1]];

// ---- 0. the fixtures are the installed specs -------------------------------------------------
expect("the fixtures compile to the specIds the sessions installed (spec-c66116660dc4, spec-86cfd6cf7fae)", specIdOf(SWING_SPEC) === SWING_SPEC_ID && specIdOf(EARLIER_SPEC) === EARLIER_SPEC_ID);

// ---- 1. session 16d12ba9: nine aim keys without roll ------------------------------------------
const scene = motionScene(batKit(SWING_KIT_AT)), swing = compileSpec(SWING_SPEC, { sk, scene }), out = swing.out, held = swing.observations.held[BAT];
const missAt = f => out.frames[f].diag.hold_r?.miss ?? 0, short = out.frames.map((_, f) => f).filter(f => missAt(f) > 1e-4);
console.log(`  16d12ba9: QA ${swing.qa.total} (was 115); keys ${JSON.stringify(held.map(h => [h.f, h.deg, h.cm]))}; arm short at f${short[0]}-f${short[short.length - 1]}`);
console.log(`  groups: ${kinds(swing).join(" | ")}`);
expect("every key is drawn within 1 deg of its aim (was up to 43.3 deg at f20)", held.every(h => h.deg <= 1), JSON.stringify(held));
expect("every key the arm reaches sits on its pos (<= 0.5 cm)", held.every(h => missAt(h.f) > 1e-4 || h.cm <= 0.5), JSON.stringify(held));
const reach = batReach(swing);
expect("what is left on the bat is the arm out of reach (keys f27-f31 too far from the shoulder): <= 6 cm, no wrist reason (was 77.0 cm, the wrist deviation needed 121 deg)",
	cm(reach) <= 6 && /the arm is [\d.]+ cm short/.test(reach.hint) && !/the wrist/.test(reach.hint), JSON.stringify(reach));
expect("QA drops from 115 to under 70", swing.qa.total < 70, swing.qa.total);
const contact = yOf(rootPoseAt(out, BAT, 27));
expect("contact (f27): the bat level through the zone, toward +Z (|y| <= 0.1, z >= 0.95)", Math.abs(contact[1]) <= 0.1 && contact[2] >= 0.95, JSON.stringify(contact));
const finish = rootPoseAt(out, BAT, 46), tip = add(finish.pos, scale(yOf(finish), 0.84)), sh = out.frames[46].s.P[I.LeftShoulder], head = out.frames[46].s.P[I.Head];
expect("follow-through (f46): the barrel over the left shoulder (0.3 m above it, 0.3 m behind it, left of the head)", tip[1] > sh[1] + 0.3 && tip[2] < sh[2] - 0.3 && tip[0] > head[0],
	JSON.stringify({ tip, sh, head }));

// ---- 2. smooth: no flip, and the right arm pops only where it runs out of reach ------------------
expect("no FLIP (was RightForeArm 75 deg)", !swing.qa.groups.some(g => g.kind === "FLIP"), kinds(swing).join(" | "));
const pops = swing.qa.groups.filter(g => g.kind === "POP" && /^Right/.test(g.subject));
expect("a right-arm POP only where the arm straightens out of reach and back (next to the frames it is short)", pops.every(g => g.first >= short[0] - 1 && g.last <= short[short.length - 1] + 1), JSON.stringify(pops));
let turn = 0;
for (let f = 1; f < out.frameCount; f++) {
	const bend = fr => { const P = fr.s.P, n = cross(sub(P[I.RightForeArm], P[I.RightArm]), sub(P[I.RightHand], P[I.RightForeArm])); return len(n) > 0.01 ? norm(n) : null; };
	const a = bend(out.frames[f - 1]), b = bend(out.frames[f]);
	if (a && b && !short.includes(f) && !short.includes(f - 1)) turn = Math.max(turn, angle(a, b));
}
expect("the elbow's bend plane turns <= 20 deg a frame while the arm is bent", turn <= 20, turn.toFixed(1));

// ---- 3. roll: left out it is the easiest, given it is exact -------------------------------------
const rolled0 = structuredClone(SWING_SPEC);
for (const k of rolled0.objects[BAT].keys) k.roll = 0;
const zero = compileSpec(rolled0, { sk, scene }), zeroRots = zero.observations.held[BAT].map(h => h.rot);
console.log(`  roll 0 on every key (the plain carry's roll, C16 before K8): REACH ${cm(batReach(zero))} cm, QA ${zero.qa.total}`);
expect("roll 0 keeps the turn from the plain carry (another rot on most keys) and leaves the wrist short: more REACH than the easiest roll",
	zeroRots.filter((q, i) => JSON.stringify(q) !== JSON.stringify(held[i].rot)).length >= 6 && cm(batReach(zero)) > 3 * cm(reach), `${cm(batReach(zero))} vs ${cm(reach)}`);

// ---- 4. deterministic, and every frame solves on its own ------------------------------------------
expect("deterministic: the same spec bakes the same take", hashOf(bakeTake(sk, out)) === hashOf(bakeTake(sk, compileSpec(SWING_SPEC, { sk, scene }).out)));
let alone = 0;
for (let f = out.frameCount - 1; f >= 0; f -= 3) {
	const s = solveFrame(out.ctx, channelsAt(out.baked, f), f).s;
	alone = Math.max(alone, ...s.P.map((p, j) => dist(p, out.frames[f].s.P[j])));
}
expect("a frame solved on its own (backwards, every third) is the compiled frame, bit for bit (the plans are per compile, not per frame order)", alone === 0, alone);

// ---- 5. the second hand turns with the bat ---------------------------------------------------------
const grips = out.frames.filter(fr => fr.diag.hold_l?.second === BAT).length;
const armLength = dist(sk.restWorldPos[I.LeftArm], sk.restWorldPos[I.LeftForeArm]) + dist(sk.restWorldPos[I.LeftForeArm], sk.restWorldPos[I.LeftHand]);
let wrist = 0, grip = 0;
for (const fr of out.frames) {
	const p = fr.diag.props.batGrip, anchor = add(p.low, SWING_SPEC.anchors.batLow.offset), h = fr.diag.hold_l;
	// where the anchor is past the soft knee of the left arm's reach (pose.js softReach), the plain arm already stops short of it
	if (dist(fr.s.P[I.LeftArm], anchor) < 0.99 * armLength) wrist = Math.max(wrist, dist(fr.s.P[I.LeftHand], anchor));
	if (h?.w === 1 && Math.abs(h.twist) <= 85 && Math.abs(h.flex) <= 70 && h.dev >= -35 && h.dev <= 20) {
		const ax = palmAxes(sk, fr.s, "Left"), want = add(scale(ax.l, 0.5), scale(ax.n, -0.866)), f = out.frames.indexOf(fr);
		grip = Math.max(grip, angle(want, yOf(rootPoseAt(out, BAT, f))));
	}
}
expect("the left hand (w_batLow_l on the bat's prop) grips on every frame, its wrist on the anchor where the arm reaches it (<= 1 mm)", grips === out.frameCount && wrist <= 0.001, `${grips} frames, ${(wrist * 1000).toFixed(2)} mm`);
expect("where its wrist can, the left hand holds the bat as the right one does, mirrored (the bat along [0, 0.5, -0.866] of its palm axes, <= 1 deg)", grip <= 1, grip.toFixed(2));
expect("the hands no longer overlap (SELF) and the left hand stays on the bat (goal)", !swing.qa.groups.some(g => g.kind === "SELF") && swing.qa.goals.find(g => g.name === "left hand stays on bat").ok, kinds(swing).join(" | "));

// ---- 6. session 6912547c: 38 rot keys ----------------------------------------------------------------
const earlier = compileSpec(EARLIER_SPEC, { sk, scene: motionScene(batKit(EARLIER_KIT_AT)) });
console.log(`  6912547c: QA ${earlier.qa.total} (was 35); ${kinds(earlier).join(" | ")}`);
// WRIST (qa/wrist-checks.js) counts apart: these 38 rot keys ask the right wrist past its flex and ulnar limits, which the
// residual (REACH) already showed as the bat off its keys; pinned below
const notWrist = r => r.qa.groups.filter(g => g.kind !== "WRIST").reduce((n, g) => n + g.count, 0);
expect("rot keys: the swivel alone halves the residual (REACH <= 6 cm, was 12.0) and the flip is gone; QA <= 30 (was 35), WRIST aside",
	cm(batReach(earlier)) <= 6 && !earlier.qa.groups.some(g => g.kind === "FLIP") && notWrist(earlier) <= 30, kinds(earlier).join(" | "));
expect("WRIST: the 38 rot keys ask the right wrist past its limits (flex 70, ulnar 35) where the bat leaves its keys",
	earlier.qa.groups.some(g => g.kind === "WRIST" && /^hand_r (flex|ulnar deviation)/.test(g.subject)), kinds(earlier).join(" | "));

// ---- 7. the J2 swing is POP-free, with its rot keys and as aims without roll ----------------------------
const j2scene = motionScene(J2.SCENE_OBJECTS), j2 = keys => { const sp = structuredClone(J2.SWING_SPEC); sp.objects[J2.BAT].keys = keys; return compileSpec(sp, { sk, scene: j2scene }); };
const j2plain = compileSpec(J2.SWING_SPEC, { sk, scene: j2scene });
for (const [name, r] of [["rot keys", j2(J2.SWING_KEYS)], ["aims without roll", j2(J2.SWING_KEYS.map(k => ({ f: k.f, pos: k.pos, aim: yOf(rootPoseAt(j2(J2.SWING_KEYS).out, J2.BAT, k.f)).map(v => +v.toFixed(2)) })))]]) {
	expect(`J2 swing, ${name}: no POP, no FLIP, no REACH, the QA of the take without keys (${j2plain.qa.total}), WRIST aside`, !r.qa.groups.some(g => ["POP", "FLIP", "REACH"].includes(g.kind)) && notWrist(r) === notWrist(j2plain), kinds(r).join(" | "));
	expect(`J2 swing, ${name}: WRIST pins the left wrist past its ulnar limit (35) on a few frames of the two-hand grip`, r.qa.groups.some(g => g.kind === "WRIST" && /^hand_l ulnar deviation/.test(g.subject) && g.count <= 8), kinds(r).join(" | "));
}

// ---- 8. the hint says what the wrist still needs after the arm turned ---------------------------------
const outward = norm(sub(J2.SWING_KEYS[2].pos, j2plain.out.frames[47].s.P[I.RightArm]));
const bad = batReach(j2(J2.SWING_KEYS.map((k, i) => (i === 2 ? { f: k.f, pos: k.pos, aim: outward } : k))));
expect("a key no arm can hold: REACH, the hint names the wrist turn still needed after the elbow swung and the forearm turned",
	/needs -?\d+deg \(limit [-\d.]+\.\.[-\d.]+\) after the elbow swung \d+deg and the forearm turned; key a pose nearer the hand/.test(bad?.hint), JSON.stringify(bad));

if (failures) { console.error(`${failures} motion3 arm-orientation check(s) failed`); process.exit(1); }
console.log("motion3 arm orientation: all checks passed");
