#!/usr/bin/env node
// Goal predicates still and speed, and after/before ordering (C8 amendment, intent round lane pred).
// The handoff's vending case: "the can stays put until the kick, then falls" is still ... before
// "kick" and moved ... after "kick", wherever the kick lands; "the foot is fast at the kick" is a
// speed goal. Scene: the cup-on-a-table fixture; the left hand (IK) rises from 0.95 m to 1.2 m over
// f0..f47 and the cup body tips on a hinge from f24 (channel tip 0 -> -90 degrees).
import { SCENE_OBJECTS, CHARACTER } from "../motion3/fixtures/cup-scene.mjs";
import { compileSpec } from "../../src/motion3/pipeline.js";
import { motionScene } from "../../src/motion3/scene.js";
import { skeletonFor } from "../../src/motion3/rigs/index.js";
import { refPoint } from "../../src/motion3/refs.js";
import { goalChecks } from "../../src/motion3/qa/goals.js";
import { repairSpec } from "../../src/motion3/repair.js";
import { len, sub } from "../../src/motion3/compiler/math.js";

let failures = 0;
function expect(name, condition, detail = "") {
	console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
	if (!condition) failures += 1;
}
const refusal = run => { try { run(); return ""; } catch (error) { return error.message; } };
const close = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

const sk = skeletonFor(CHARACTER.model), scene = motionScene(SCENE_OBJECTS);
const base = (extra = {}) => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 48,
	use: [{ skill: "standIdle", args: { at: [0, 0], heading: 0 }, f0: 0 }],
	keys: [{ f: 0, set: { armw_l: 1, hand_l: [0.2, 0.95, 0.25], tip: 0 } }, { f: 24, set: { tip: 0 } }, { f: 47, set: { hand_l: [0.2, 1.2, 0.3], tip: -90 } }],
	objects: { cylinder: { pivot: [0.24, 0.75, 0.85], axis: [0, 0, 1], channel: "tip" } },
	anchors: { spot: { kind: "world", p: [0.2, 1.2, 0.4] } }, ...extra });
const run = (goals, extra = {}) => compileSpec(base({ goals, ...extra }), { sk, scene });
const { out } = run(undefined);
const travel = f => len(sub(refPoint(out, f, "object:cylinder.base"), [0.2, 0.75, 0.85]));
const groupOf = (r, name) => r.qa.groups.find(g => g.subject.startsWith(`${name}:`));
// the first frame the cup base is 2 cm off its scene pose: the "tips" event
const TIPS = { name: "tips", moved: "object:cylinder", by: 0.02, at: [0, 47], mode: "any" };
const e = [...Array(48).keys()].find(f => travel(f) >= 0.02);
expect("the fixture: the cup is at rest before f24 and 2 cm off its pose at some frame after", travel(23) < 1e-6 && e > 24 && e < 47, { e });

// 1. still: an object stays at its scene pose; a point stays where it is at at[0]
let r = run([{ name: "cup still", still: "object:cylinder", at: [0, 23] }]);
expect("still passes while the hinge has not turned (default tol 0.01)", r.qa.ok && r.qa.goals[0].kind === "still" && r.qa.goals[0].need === 0.01 && r.qa.goals[0].value === 0, r.qa.goals);
r = run([{ name: "cup still", still: "object:cylinder", at: [0, 47] }]);
let g = groupOf(r, "cup still");
expect("still fails on every frame the cup is more than tol off its pose, and says how far, from its scene pose",
	!r.qa.ok && g.first > 24 && g.last === 47 && close(r.qa.goals[0].value, travel(47)) && g.subject.startsWith("cup still: ") && g.subject.includes(" m from its scene pose at f") && g.subject.endsWith("(needs <= 0.01)"), g);
expect("still on an object nothing holds: the hint names the object and has no fix", /^objects\.cylinder$/.test(g.cause) && /cylinder moves at f\d+, where it should stay/.test(g.hint) && !g.fix, g);
r = run([{ name: "hand still", still: "joint:LeftHand", tol: 0.005, at: [0, 47] }]);
g = groupOf(r, "hand still");
expect("still on a point measures from at[0]; the hint moves the hand back toward it", !r.qa.ok && g.subject.includes(" m from f0 at f") && g.fix?.channel === "hand_l", g);
r = run([{ name: "bare", still: "cylinder", at: [0, 20] }]);
expect("a bare id in still is an object ref", r.qa.ok && r.qa.goals[0].ok, r.qa.goals);

// 2. speed: central difference in m/s; mode any by default, all when asked
const v = f => (len(sub(refPoint(out, f + 1, "joint:LeftHand"), refPoint(out, f - 1, "joint:LeftHand"))) * 24) / 2;
const peak = Math.max(...[...Array(46).keys()].map(i => v(i + 1)));
r = run([{ name: "hand moves", speed: "joint:LeftHand", by: peak - 0.01, at: [1, 46] }]);
expect("speed passes on its best frame by default (mode any), value = the peak speed in m/s", r.qa.ok && r.qa.goals[0].kind === "speed" && close(r.qa.goals[0].value, peak), { peak, goals: r.qa.goals });
r = run([{ name: "hand moves", speed: "joint:LeftHand", by: peak - 0.01, at: [1, 46], mode: "all" }]);
expect("speed with mode all fails where the hand is slower", !r.qa.ok && groupOf(r, "hand moves").count > 1, r.qa.groups[0]);
r = run([{ name: "fast", speed: "joint:LeftHand", by: 3, at: [1, 46] }]);
g = groupOf(r, "fast");
expect("speed fails with the shortfall in m/s, one issue at the best frame, and a hint without a fix",
	!r.qa.ok && g.count === 1 && close(g.worst, 3 - peak) && /^fast: [\d.]+ m\/s at f\d+, the best of f1-f46 \(needs >= 3\)$/.test(g.subject) && /too slow at f\d+/.test(g.hint) && /m\/s short; needs >= 3/.test(g.hint) && !g.fix, g);
r = run([{ name: "cup falls fast", speed: "object:cylinder.top", by: 0.1, at: [24, 47] }]);
expect("speed reads a moving object's point too", r.qa.goals[0].ok && r.qa.goals[0].value > 0.1, r.qa.goals);
const edge = goalChecks(out, [{ name: "edge", speed: "joint:LeftHand", by: 0.0001, at: 0 }]).results[0];
expect("speed at the take's first frame is one-sided", edge.ok && Number.isFinite(edge.value), edge);

// 3. after / before: windows cut at the first frame another goal holds
r = run([TIPS, { name: "cup still before", still: "object:cylinder", tol: 0.02, at: [0, 47], before: "tips" }]);
expect("still ... before \"tips\" holds although the cup moves later (window f0..f(e-1))", r.qa.ok && r.qa.goals[1].ok && r.qa.goals[1].at <= e - 1, { e, goals: r.qa.goals });
r = run([TIPS, { name: "cup still", still: "object:cylinder", tol: 0.02, at: [0, 47] }]);
expect("the same still without before fails", !r.qa.goals[1].ok, r.qa.goals);
r = run([TIPS, { name: "hand high after", above: ["joint:LeftHand", "object:cube.top"], by: 0.3, at: [0, 47], after: "tips", mode: "any" }]);
expect("after \"tips\": the goal measures only frames after the event", r.qa.goals[1].ok && r.qa.goals[1].at > e, { e, goals: r.qa.goals });
r = run([TIPS, { name: "hand high early", above: ["joint:LeftHand", "object:cube.top"], by: 0.45, at: [0, 47], before: "tips", mode: "any" }]);
expect("before \"tips\": a goal met only after the event fails", !r.qa.goals[1].ok && r.qa.goals[1].at < e, { e, goals: r.qa.goals });
r = run([{ name: "never", moved: "object:cylinder", by: 5, at: [0, 47] }, { name: "falls after", moved: "object:cylinder", by: 0.02, at: [0, 47], after: "never" }]);
g = groupOf(r, "falls after");
expect("after a goal that never holds: ok false, value and at null, one GOAL issue that says so",
	!r.qa.ok && r.qa.goals[1].ok === false && r.qa.goals[1].value === null && r.qa.goals[1].at === null && g.count === 1 && g.subject === 'falls after: waits for "never" (after), which never holds', { goals: r.qa.goals, g });
expect("its hint points at the goal it waits for", /make goal "never" hold/.test(g.hint) && !g.fix, g);
r = run([TIPS, { name: "late window", still: "object:cylinder", at: [e + 1, 40], before: "tips" }]);
g = groupOf(r, "late window");
expect("a window the event closes before it opens fails with no frames left", !r.qa.goals[1].ok && g.subject === `late window: no frames left before "tips" (it holds first at f${e}; at is f${e + 1}-f40)`, g);
r = run([{ ...TIPS, after: "hand up" }, { name: "hand up", above: ["joint:LeftHand", "object:cube.top"], by: 0.3, at: [0, 47], mode: "any" }, { name: "chain", still: "object:cylinder", at: [0, 47], after: "tips" }]);
g = groupOf(r, "chain");
expect("events chain (chain after tips after hand up, a goal named before it is listed): chain measures from tips' event on", r.qa.goals[0].ok && r.qa.goals[1].ok && g.first === e + 1, { e, goals: r.qa.goals, g });
const windowed = { ...out, f0: 30, frames: out.frames.slice(30) };
const wres = goalChecks(windowed, [{ name: "early", near: ["joint:LeftHand", "anchor:spot"], tol: 0.5, at: [0, 10] }, { name: "x", near: ["joint:LeftHand", "anchor:spot"], tol: 0.5, at: [0, 47], after: "early" }]);
expect("a windowed trial compile that cannot see the event answers nothing for the waiting goal", wres.results.length === 0 && wres.issues.length === 0, wres);

// 4. validation: exact messages
const invalid = goals => refusal(() => run(goals)).replace(/^MOTION_SPEC_INVALID: /, "").split("\n");
const cases = [
	[[{ speed: "joint:LeftHand", at: 3 }], ["goals[0].speed needs by: the speed the point must reach, in m/s (e.g. by: 2)"]],
	[[{ speed: "joint:LeftHand", by: 0, at: 3 }], ["goals[0].by must be a number > 0 (m/s), got 0"]],
	[[{ speed: "joint:LeftHand", tol: 2, at: 3 }], ["goals[0].tol applies to near and still; speed takes by (the point reaches by m/s): use by: 2 (m/s), not tol", "goals[0].speed needs by: the speed the point must reach, in m/s (e.g. by: 2)"]],
	[[{ still: "joint:LeftHand", at: 3 }], ['goals[0].still "joint:LeftHand" measures how far the point strays from where it is at at[0], so at must be [f0, f1] with f0 < f1, got 3']],
	[[{ still: "object:cylinder", by: 0.1, at: 3 }], ["goals[0].by applies to above, moved and speed; still takes tol"]],
	[[{ name: "a", still: "object:cylinder", at: 3, after: "b" }, { name: "b", moved: "object:cylinder", at: 4, before: "a" }], ['goals wait on each other through after/before: "a" -> "b" -> "a"; one of them must not wait']],
	[[{ name: "a", still: "object:cylinder", at: 3, after: "a" }], ["goals[0].after names the goal itself; name the goal whose first met frame this one waits for"]],
	[[{ name: "kick", moved: "object:cylinder", at: 3 }, { still: "object:cylinder", at: 3, before: "kik" }], ['goals[1].before must name another goal (its name, or goals[<i>] when it has none), got "kik"; did you mean "kick"?']],
	[[{ moved: "object:cylinder", at: 3 }, { still: "object:cylinder", at: 3, before: "goals[0]" }], [""]],
];
for (const [goals, want] of cases) {
	const got = invalid(goals);
	expect(`validation: ${want[0].slice(0, 70) || "an unnamed goal is named goals[i]"}`, JSON.stringify(got) === JSON.stringify(want), got);
}

// 5. repair runs with the new kinds: it keeps a met still goal and does not crash on speed or a waiting goal
const repaired = repairSpec(base({ goals: [TIPS, { name: "still before", still: "object:cylinder", tol: 0.02, at: [0, 47], before: "tips" }, { name: "fast", speed: "joint:LeftHand", by: 3, at: [1, 46] }] }), { rounds: 2 },
	s => compileSpec(s, { sk, scene }));
expect("repair { rounds: 2 } answers with the new kinds, and the met goals still hold", repaired.result.qa.goals.find(x => x.name === "still before").ok && repaired.result.qa.goals.find(x => x.name === "tips").ok, repaired.result.qa.goals);

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("PASS goal predicates still, speed, after/before");
