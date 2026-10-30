#!/usr/bin/env node
// Lane P2 (docs/motion-api-v3.1.md C13): QA reports a pop as a spike and reads a bend plane only where
// one exists, so an athletic swing passes without checks.limits. Session f0f2be59 loosened its limits
// to install a bat swing (accLimb 0.05 -> 0.35, flip 60 -> 75, "forearm twist"); session df6acdcc
// installed one at QA 4 with POP LeftForeArm 5.95 cm/f^2 (the left elbow's launch into the swing: the
// two frames around it push the same way) and FLIP RightForeArm 71 deg (the right elbow folded flat,
// 165-171 deg, as the wrist passed the shoulder; the elbow moved 3 cm in that frame).
import { takeHash as hashOf } from "../motion3/fixtures/take-hash.mjs";
import { FOLD_SPEC, FOLD_SPEC_ID, FOLD_KIT_AT } from "../motion3/fixtures/bat-fold.mjs";
import { CLEAN_SPEC, CLEAN_SPEC_ID, CLEAN_KIT_AT, STANCE_SPEC, STANCE_KIT_AT } from "../motion3/fixtures/bat-stance.mjs";
import { SWING_SPEC as L2_SWING, SWING_SPEC_ID as L2_SWING_ID, batScene } from "../motion3/fixtures/ground-sessions.mjs";
import { EARLIER_SPEC, EARLIER_KIT_AT, batKit } from "../motion3/fixtures/bat-aim-swing.mjs";
import { compileSpec } from "../motion3/fixtures/legacy-compile.mjs";
import { generalChecks } from "../../src/motion3/qa/checks.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { bakeTake } from "../../src/motion3/take.js";
import { specIdOf } from "../../src/motion3/spec-store.js";
import { buildKit } from "../../src/kits/index.js";
import { WRIST_LIMITS } from "../../src/motion3/compiler/arm-orient.js";
import { rangeOf } from "../../src/motion3/compiler/vocab.js";
import { wrist } from "../../src/motion3/compiler/limbs.js";
import { pose } from "../../src/motion3/compiler/pose.js";
import { add, sub, scale, norm, cross, dot, dist, angle, apply, axisRot } from "../../src/motion3/compiler/math.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const sk = skeletonFor("y-bot-tpose"), I = sk.index;
const kinds = r => r.qa.groups.map(g => `${g.kind} ${g.subject} n${g.count} f${g.first}-${g.last}`);
const has = (r, kind, re = /./) => r.qa.groups.some(g => g.kind === kind && re.test(g.subject));
const noLimits = spec => { const c = structuredClone(spec); delete c.checks.limits; return c; };
const bendAt = (out, f, S) => { const P = out.frames[f].s.P; return angle(sub(P[I[`${S}ForeArm`]], P[I[`${S}Arm`]]), sub(P[I[`${S}Hand`]], P[I[`${S}ForeArm`]])); };

// ---- 0. the fixtures are the installed specs ---------------------------------------------------
expect("the fixtures compile to the specIds the sessions installed (df6acdcc, f0f2be59, 9dcf19c5)",
	specIdOf(FOLD_SPEC) === FOLD_SPEC_ID && specIdOf(CLEAN_SPEC) === CLEAN_SPEC_ID && specIdOf(L2_SWING) === L2_SWING_ID);

// ---- 1. the agent's swings without checks.limits --------------------------------------------------
const foldScene = motionScene(buildKit("bat", [], { position: { x: FOLD_KIT_AT[0], y: FOLD_KIT_AT[1], z: FOLD_KIT_AT[2] } }).records);
const fold = compileSpec(FOLD_SPEC, { sk, scene: foldScene });
const clean = compileSpec(noLimits(CLEAN_SPEC), { sk, scene: motionScene(batKit(CLEAN_KIT_AT)) });
const l2 = compileSpec(L2_SWING, { sk, scene: motionScene(batScene()) });
console.log(`  df6acdcc: QA ${fold.qa.total} (was 4): ${kinds(fold).join(" | ")}`);
console.log(`  f0f2be59 without limits: QA ${clean.qa.total}; 9dcf19c5: QA ${l2.qa.total}, ${[...new Set(l2.qa.groups.map(g => g.kind))].join(" ")}`);
// lane P3: the elbow stops at 150 deg; f0f2be59's stance key asks the right elbow for 152 deg, so the bat is drawn 1.2 cm off it
expect("f0f2be59's swing is clean without the limits the agent set (accLimb 0.35, flip 75) but for its stance key's elbow fold (REACH f0-f3, lane P3)",
	clean.qa.groups.length === 1 && has(clean, "REACH", /^empty: 1\.\d cm off its keys$/) && clean.qa.groups[0].last === 3 && /inside the forearm's reach/.test(clean.qa.groups[0].hint), kinds(clean).join(" | "));
expect("no POP on any of the three swings (df6acdcc had LeftForeArm 5.95 cm/f^2 at f31)", ![fold, clean, l2].some(r => has(r, "POP")), [fold, l2].map(r => kinds(r).join(" | ")).join(" || "));
expect("df6acdcc: no FLIP on the folded right elbow (was 71 deg at f35)", !has(fold, "FLIP", /^RightForeArm/), kinds(fold).join(" | "));
// lane P3: the right elbow stops at 150 deg, so the keys that drive the wrist into the shoulder are a REACH residual (10.9 cm);
// lane Q1: the left hand's roll is priced past what QA allows a hand in the torso, and it no longer flips onto the handle (61 deg at f12)
// WRIST (qa/wrist-checks.js): the keys that fold the right elbow also ask the wrists past their limits there; real too
expect("df6acdcc: what is left is real: the keys folding the right elbow (REACH), the bat in the chest (COLLIDE f30) and the wrists those keys bend past their limits (WRIST)",
	fold.qa.groups.filter(g => g.kind !== "WRIST").length === 2 && has(fold, "REACH", /^empty: 10\.9 cm off its keys$/) && has(fold, "COLLIDE", /^torso_hi x empty$/) && has(fold, "WRIST", /^hand_r ulnar deviation/), kinds(fold).join(" | "));

// ---- 2. why the right elbow's plane turned: folded flat, not flipped -------------------------------
const P = f => fold.out.frames[f].s.P, elbowMove = dist(P(35)[I.RightForeArm], P(34)[I.RightForeArm]);
console.log(`  df6acdcc right elbow: bend f33-f36 ${[33, 34, 35, 36].map(f => bendAt(fold.out, f, "Right").toFixed(0)).join(" ")} deg, moved ${(elbowMove * 100).toFixed(1)} cm into f35`);
// lane P3: it folded to 165-171 deg there; the elbow now stops at 150 deg (compiler/limbs.js ELBOW_STOP)
expect("the df6acdcc right elbow stops at 150 deg at f34 and f35 (it folded to 165-171 deg)",
	[34, 35].every(f => bendAt(fold.out, f, "Right") > 149.9 && bendAt(fold.out, f, "Right") < 150.01), `${bendAt(fold.out, 34, "Right")} ${bendAt(fold.out, 35, "Right")} ${elbowMove}`);

// ---- 3. a hard burst is not a pop; a spike still is --------------------------------------------------
const stance = compileSpec(STANCE_SPEC, { sk, scene: motionScene(batKit(STANCE_KIT_AT)) });
const earlier = compileSpec(EARLIER_SPEC, { sk, scene: motionScene(batKit(EARLIER_KIT_AT)) });
expect("the hips turning round (STANCE f21) and the head slowing over 2 frames (EARLIER f38) are no POP", !has(stance, "POP", /^Hips/) && !has(earlier, "POP", /^Head/),
	[...kinds(stance), ...kinds(earlier)].filter(s => s.startsWith("POP")).join(" | "));
expect("the left hand jumping onto the handle in 2 frames (STANCE f2-3, 64 cm then 0.6 cm a frame) still pops", has(stance, "POP", /^LeftHand/), kinds(stance).join(" | "));

// injected one-frame glitches and steps: the joint and everything under it moved by d at f (or from f on)
const subtree = j => sk.names.map((_, i) => i).filter(i => { for (let p = i; p >= 0; p = sk.parent[p]) if (p === j) return true; return false; });
function inject(out, joint, f, d, step) {
	const ids = new Set(subtree(I[joint]));
	return { ...out, frames: out.frames.map((fr, q) => ((step ? q >= f : q === f) ? { ...fr, s: { ...fr.s, P: fr.s.P.map((p, i) => (ids.has(i) ? add(p, d) : p)) } } : fr)) };
}
const issues = out => generalChecks(sk, out, {});
const popsNear = (out, joint, f) => issues(out).some(i => i.kind === "POP" && i.msg.startsWith(`${joint} `) && Math.abs(i.frame - f) <= 1);
const STAND = { use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } }] };
const idle = compileSpec({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 266, ...STAND, use: [...STAND.use, { skill: "smokeCigarette", f0: 1, args: {} }] }, { sk, scene: { objects: {} } });
const fastest = (out, joint) => { let at = 3; for (let f = 3; f < out.frames.length - 3; f++) if (dist(out.frames[f].s.P[I[joint]], out.frames[f - 1].s.P[I[joint]]) > dist(out.frames[at].s.P[I[joint]], out.frames[at - 1].s.P[I[joint]])) at = f; return at; };
const across = (out, joint, f, d) => { const v = sub(out.frames[f + 1].s.P[I[joint]], out.frames[f - 1].s.P[I[joint]]); return scale(norm(cross(v, [0, 1, 0])), d); };
const slow = [[idle.out, "RightHand", 60, 0.03, false], [idle.out, "RightHand", 150, 0.05, true], [idle.out, "Hips", 40, 0.02, false], [idle.out, "Hips", 200, 0.03, true], [idle.out, "LeftForeArm", 120, 0.03, false]]
	.filter(([out, j, f, d, step]) => !popsNear(inject(out, j, f, [0, d, 0], step), j, f));
expect("injected pops in a slow take still pop: hand 3 cm glitch and 5 cm step, hips 2 cm glitch and 3 cm step, elbow 3 cm glitch", !popsNear(idle.out, "RightHand", 60) && slow.length === 0, JSON.stringify(slow.map(s => s.slice(1))));
const fastCases = [[clean.out, "RightHand"], [clean.out, "LeftHand"], [fold.out, "RightHand"], [l2.out, "RightHand"]].map(([out, j]) => [out, j, fastest(out, j)]);
console.log(`  fastest frames: ${fastCases.map(([out, j, f]) => `${j} f${f} ${(dist(out.frames[f].s.P[I[j]], out.frames[f - 1].s.P[I[j]]) * 100).toFixed(1)} cm/frame`).join(", ")}`);
// df6acdcc's fastest frame (f38) follows the right hand leaving the elbow stop (lane P3: f36 12 cm/f^2 as the held wrist
// rejoins its target), a burst a 15 cm step hides in; its 10 cm glitch still pops
const missed = fastCases.flatMap(([out, j, f]) => [[0.1, false], [0.15, true]].filter(([, step]) => !(step && out === fold.out)).filter(([d, step]) => !popsNear(inject(out, j, f, across(out, j, f, d), step), j, f)).map(([d, step]) => `${j} f${f} ${step ? "step" : "glitch"} ${d}`));
expect("injected pops at the fastest frame of a swing still pop (a 10 cm glitch and a 15 cm step across the hand's path)", missed.length === 0, missed.join(", "));

// ---- 4. a flipped pole still is a FLIP ------------------------------------------------------------------
/** The elbow or knee of limb [a, b, c] turned deg about a->c at f (or from f on); or put on a->c (straight) at f and turned from f+1 on. */
function swivel(out, [a, b, c], f, deg, how) {
	return { ...out, frames: out.frames.map((fr, q) => {
		const turn = how === "glitch" ? q === f : how === "step" ? q >= f : q > f, line = how === "through" && q === f;
		if (!turn && !line) return fr;
		const p = fr.s.P.slice(), A = p[I[a]], C = p[I[c]], u = norm(sub(C, A));
		p[I[b]] = line ? add(A, scale(u, dot(sub(p[I[b]], A), u))) : add(A, apply(axisRot(u, deg), sub(p[I[b]], A)));
		return { ...fr, s: { ...fr.s, P: p } };
	}) };
}
const flipAt = (out, joint, f) => issues(out).some(i => i.kind === "FLIP" && i.msg.startsWith(`${joint} `) && i.frame >= f && i.frame <= f + 1);
const ARM = ["RightArm", "RightForeArm", "RightHand"];
const bentFrame = [30, 60, 90, 120, 150, 180, 210].find(f => bendAt(idle.out, f, "Right") > 40 && bendAt(idle.out, f, "Right") < 140);
const walk = compileSpec({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 160, use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } }, { skill: "walkTo", f0: 1, args: { to: [0, 2.4], steps: 6, heading: 0 } }] }, { sk, scene: { objects: {} } });
const knee = (out, f) => { const p = out.frames[f].s.P; return angle(sub(p[I.LeftLeg], p[I.LeftUpLeg]), sub(p[I.LeftFoot], p[I.LeftLeg])); };
const kneeFrame = Array.from({ length: 100 }, (_, i) => 30 + i).find(f => knee(walk.out, f) > 30);
console.log(`  swivels: right elbow at f${bentFrame} (bend ${bendAt(idle.out, bentFrame, "Right").toFixed(0)}), left knee at f${kneeFrame} (bend ${knee(walk.out, kneeFrame).toFixed(0)})`);
expect("the takes the flips go into have none of their own", !issues(idle.out).some(i => i.kind === "FLIP") && !issues(walk.out).some(i => i.kind === "FLIP"));
expect("a bent elbow turned 120 deg for one frame, or 90 deg from a frame on, is a FLIP",
	flipAt(swivel(idle.out, ARM, bentFrame, 120, "glitch"), "RightForeArm", bentFrame) && flipAt(swivel(idle.out, ARM, bentFrame, 90, "step"), "RightForeArm", bentFrame));
const through = issues(swivel(idle.out, ARM, bentFrame, 180, "through")).find(i => i.kind === "FLIP" && i.msg.startsWith("RightForeArm "));
expect("an elbow that goes straight for a frame and comes back on the other side is a FLIP over 2 frames", through?.frame === bentFrame + 1 && / over 2 frames$/.test(through.msg), JSON.stringify(through));
expect("a walking knee turned 120 deg for one frame is a FLIP", flipAt(swivel(walk.out, ["LeftUpLeg", "LeftLeg", "LeftFoot"], kneeFrame, 120, "glitch"), "LeftLeg", kneeFrame));

// ---- 5. QA does not change takes: the swings bake as before -------------------------------------------
// lane P3 changed all three: each folds an elbow past 145 deg (df6acdcc right 171, f0f2be59 right 152, 9dcf19c5 left 151), where the elbow now eases onto its stop;
// lane Q1 df6acdcc (the left hand's roll priced past the BODY allowance) and 9dcf19c5 (the flat front foot keeps its heading until it lifts)
// Flow (compiler/channels.js: the free spine, head and arms carry through keys and trail) re-baked the takes whose arms swing
// free (exitcar, walk, cup run3, the standing smokes, df6acdcc, 6262a69c); their QA did not change.
const HASHES = { df6acdcc: [fold, "f912e5753d15fa42"], "f0f2be59 without limits": [clean, "cf692814ca099e0e"], "9dcf19c5": [l2, "6c6926016a279376"] };
const changed = Object.entries(HASHES).map(([k, [r, h]]) => [k, hashOf(bakeTake(sk, r.out)), h]).filter(([, got, h]) => got !== h);
expect("the three swings bake bit for bit as before (df6acdcc and f0f2be59 retime: what QA calls a pop did not change there)", changed.length === 0, JSON.stringify(changed));

// ---- 6. the wrist and forearm turn within one set of limits ---------------------------------------------
expect("forearm twist (pronation, supination) -85..85 deg from the hand's rest: inside the active 80-90 deg each way",
	WRIST_LIMITS.twist[0] === -85 && WRIST_LIMITS.twist[1] === 85, JSON.stringify(WRIST_LIMITS));
expect("the wtwist/wflex channels take the hold solver's limits (vocab ranges = WRIST_LIMITS)",
	["l", "r"].every(k => String(rangeOf(`wtwist_${k}`).slice(1, 3)) === String(WRIST_LIMITS.twist) && String(rangeOf(`wflex_${k}`).slice(1, 3)) === String(WRIST_LIMITS.flex)));
const turned = deg => { const s = pose(sk, {}).s; wrist(sk, s, "Right", deg, 0); return s.P[I.RightHandPinky1]; };
expect("an FK wrist twist past the limit stops at it (wrist(): 120 deg turns the hand as 85 does)", dist(turned(120), turned(WRIST_LIMITS.twist[1])) < 1e-9 && dist(turned(80), turned(85)) > 1e-4);

if (failures) { console.error(`${failures} motion3 QA spike check(s) failed`); process.exit(1); }
console.log("motion3 QA spikes and flips: all checks passed");
