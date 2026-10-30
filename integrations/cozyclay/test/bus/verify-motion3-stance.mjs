#!/usr/bin/env node
// Lane N1 (docs/motion-api-v3.1.md C14, C16): a batting stance and load as an agent writes them are
// holdable, and the left hand stays on the handle out of the torso. Session d5c110a7 installed the
// same request at QA 110 (REACH "empty: 53.4 cm off its keys" f0-57) where session f0f2be59 got QA 0.
// The cause: the right arm is a straight FK arm (the keys lead it), and its "bend" was the 1 mm the
// Y Bot's elbow sits up the arm (the upper arm is 2 mm shorter than the forearm). As the swivel's
// reference that put the elbow "up", so the limit 100 deg from it ruled out an elbow pointing down;
// the roll picked for each stance key folded the arm flat (wrist 6-9 cm from the shoulder) and the
// frames between the keys broke away (f10: the wrist twist needed 120 deg).
import { STANCE_SPEC, STANCE_SPEC_ID, STANCE_KIT_AT, CLEAN_SPEC, CLEAN_SPEC_ID, CLEAN_KIT_AT } from "../motion3/fixtures/bat-stance.mjs";
import { CHARACTER, BAT, batKit } from "../motion3/fixtures/bat-aim-swing.mjs";
import { compileSpec } from "../motion3/fixtures/legacy-compile.mjs";
import { solveFrame } from "../../src/motion3/compiler/compile.js";
import { channelsAt } from "../../src/motion3/compiler/channels.js";
import { pose } from "../../src/motion3/compiler/pose.js";
import { bendPlane } from "../../src/motion3/compiler/hold.js";
import { carried } from "../../src/motion3/compiler/limbs.js";
import { ELBOW_REST } from "../../src/motion3/compiler/arm-orient.js";
import { curveIn, keyedPose } from "../../src/motion3/object-keys.js";
import { rootPoseAt } from "../../src/motion3/object-pose.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { specIdOf } from "../../src/motion3/spec-store.js";
import { add, sub, scale, apply, dist, len, norm, dot } from "../../src/motion3/compiler/math.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${detail}`}`);
	if (!condition) failures += 1;
}
const sk = skeletonFor(CHARACTER.model), I = sk.index;
const kinds = r => r.qa.groups.map(g => `${g.kind} ${g.subject} n${g.count} f${g.first}-${g.last}`);
const group = (r, kind, re) => r.qa.groups.find(g => g.kind === kind && re.test(g.subject));
/** The bat's residual at frame f: the farther of its two ends between the keyed and the drawn pose (m). */
const offAt = (out, f) => {
	const want = keyedPose(curveIn(out, BAT), f), got = rootPoseAt(out, BAT, f);
	return Math.max(...[[0, 0, 0], [0, 0.84, 0]].map(c => dist(add(want.pos, apply(want.R, c)), add(got.pos, apply(got.R, c)))));
};
const worst = (out, a, b) => Math.max(...Array.from({ length: b - a + 1 }, (_, i) => offAt(out, a + i)));

// ---- 0. the fixtures are the installed specs -------------------------------------------------
expect("the fixtures compile to the specIds the sessions installed (spec-f46b8389f1fc, spec-765240635845)", specIdOf(STANCE_SPEC) === STANCE_SPEC_ID && specIdOf(CLEAN_SPEC) === CLEAN_SPEC_ID);

// ---- 1. a straight arm swivels from its upper arm's own roll -----------------------------------
const rest = pose(sk, {}).s, shoulder = rest.P[I.RightArm], wrist = rest.P[I.RightHand], elbow = rest.P[I.RightForeArm];
const leftover = sub(elbow, scale(add(shoulder, wrist), 0.5)), along = dot(norm(leftover), norm(sub(wrist, shoulder)));
expect("a straight FK arm keeps 1 mm off its shoulder-wrist midpoint, along the arm (no bend plane)", len(leftover) < 0.002 && Math.abs(along) > 0.9, `${len(leftover)} m, ${along}`);
expect("bendPlane of a straight arm is the upper arm's rest bend carried by the bone", dist(bendPlane(sk, rest, "Right"), carried(sk, rest, I.RightArm, ELBOW_REST)) === 0);
const bent = pose(sk, { abend_r: 40 }).s;
expect("bendPlane of a bent arm is its bend", dist(bendPlane(sk, bent, "Right"), sub(bent.P[I.RightForeArm], scale(add(bent.P[I.RightArm], bent.P[I.RightHand]), 0.5))) === 0);

// ---- 2. session d5c110a7: the stance and the load hold ------------------------------------------
const scene = motionScene(batKit(STANCE_KIT_AT)), stance = compileSpec(STANCE_SPEC, { sk, scene }), out = stance.out, held = stance.observations.held[BAT];
const reach = group(stance, "REACH", /off its keys$/), folded = Math.min(...[0, 5, 10, 14].map(f => dist(out.frames[f].s.P[I.RightHand], out.frames[f].s.P[I.RightArm])));
console.log(`  d5c110a7: QA ${stance.qa.total} (was 110); keys ${JSON.stringify(held.map(h => [h.f, h.deg, h.cm]))}; stance f0-f16 ${(worst(out, 0, 16) * 100).toFixed(1)} cm, load f17-f22 ${(worst(out, 17, 22) * 100).toFixed(1)} cm`);
console.log(`  groups: ${kinds(stance).join(" | ")}`);
expect("the stance (f0-f16) is drawn on its keys within 1 cm (was 50.6 cm at f10)", worst(out, 0, 16) <= 0.01, worst(out, 0, 16));
expect("the stance and load keys f0, f14, f22 are drawn within 1 deg and 0.5 cm (was 3.8, 15.2, 14.2 deg)", held.slice(0, 3).every(h => h.deg <= 1 && h.cm <= 0.5), JSON.stringify(held.slice(0, 3)));
expect("the right elbow is not folded flat in the stance (wrist >= 14 cm from the shoulder; was 5.6 cm at f10)", folded >= 0.14, folded.toFixed(3));
expect("REACH is left only after the stance and under 13 cm: the load's in-between (twist 88-92 deg) and the follow-through out of reach (was 53.4 cm f0-57)",
	reach && reach.first >= 17 && reach.worst <= 0.13, JSON.stringify(reach));
// WRIST (qa/wrist-checks.js) counts apart: the same in-between keys the REACH above leaves ask the wrist past its limits
const wristCount = stance.qa.groups.filter(g => g.kind === "WRIST").reduce((n, g) => n + g.count, 0);
expect("QA drops from 110 to 45 or less, WRIST aside", stance.qa.total - wristCount <= 45, `${stance.qa.total} (WRIST ${wristCount})`);
expect("WRIST: the load's in-between keys ask a wrist past its limits on the frames REACH reports", wristCount > 0, stance.qa.groups.map(g => `${g.kind} ${g.subject} n${g.count}`).join(" | "));

// ---- 3. the left hand stays on the handle, out of the torso ----------------------------------------
const grips = out.frames.slice(3, 25).map(fr => fr.diag.hold_l?.w ?? 0);
expect("the left hand grips the handle through the stance and load (f3-f24 w >= 0.5; was 0.0-0.35)", grips.every(w => w >= 0.5), grips.map(w => w.toFixed(2)).join(" "));
expect("no BODY hand_l (was torso_lo n13, torso_hi n8) and hand_l x empty on 4 frames or fewer (was 27)",
	!stance.qa.groups.some(g => g.kind === "BODY" && /hand_l/.test(g.subject)) && (group(stance, "COLLIDE", /^hand_l x empty$/)?.count ?? 0) <= 4, kinds(stance).join(" | "));

// ---- 4. GRAB: a grab at frame 0 picks nothing up --------------------------------------------------
expect("grab 0 (in hand from the first frame, as with no grab) gives no GRAB (was 'hand 63.6 cm from it at grab')", !stance.qa.groups.some(g => g.kind === "GRAB"), kinds(stance).join(" | "));
const late = structuredClone(STANCE_SPEC);
late.objects[BAT].grab = 1;
late.objects[BAT].keys = late.objects[BAT].keys.filter(k => k.f > 0);
const pick = group(compileSpec(late, { sk, scene }), "GRAB", /^empty: hand/);
expect("a grab at f1 of the kit on the floor still is a GRAB group", pick?.worstFrame === 1 && pick.worst > 0.1, JSON.stringify(pick));

// ---- 5. session f0f2be59 stays clean ----------------------------------------------------------------
// lane P3: the elbow stops at 150 deg; the stance key f0 asks the right elbow for 152 deg, so it alone is drawn 1.2 cm off
const clean = compileSpec(CLEAN_SPEC, { sk, scene: motionScene(batKit(CLEAN_KIT_AT)) }), held0 = clean.observations.held[BAT];
console.log(`  f0f2be59: QA ${clean.qa.total} (was 0); keys ${JSON.stringify(held0.map(h => [h.f, h.deg, h.cm]))}`);
expect("f0f2be59 draws every key within 1 deg and 0.5 cm but the stance key f0, whose elbow fold is past the stop (REACH f0-f3, 1.2 cm)",
	clean.qa.groups.length === 1 && group(clean, "REACH", /^empty: 1\.2 cm off its keys$/)?.last === 3 && held0.every(h => h.deg <= 1 && h.cm <= (h.f === 0 ? 1.5 : 0.5)), kinds(clean).join(" | "));

// ---- 6. deterministic, and every frame solves on its own ----------------------------------------------
let alone = 0;
for (let f = out.frameCount - 1; f >= 0; f -= 3) {
	const s = solveFrame(out.ctx, channelsAt(out.baked, f), f).s;
	alone = Math.max(alone, ...s.P.map((p, j) => dist(p, out.frames[f].s.P[j])));
}
expect("a frame solved on its own (backwards, every third) is the compiled frame, bit for bit (the second hand's plans are per compile)", alone === 0, alone);
const again = compileSpec(STANCE_SPEC, { sk, scene }).out;
expect("deterministic: the same spec solves the same frames", out.frames.every((fr, f) => fr.s.P.every((p, j) => dist(p, again.frames[f].s.P[j]) === 0)));

if (failures) { console.error(`${failures} motion3 stance check(s) failed`); process.exit(1); }
console.log("motion3 batting stance: all checks passed");
