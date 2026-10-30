// The interaction bench's measurement (test/bench, docs/qa/agent-bench.md S6-S10): the committed fixtures are
// what the builder makes; real compiles of hand-written takes score as they should (the seat skill seats the
// character on the S9 chair; standing still does not); and on synthetic tracks every event chain passes when
// cause, contact and effect come in order and fails when the effect comes first.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fixtureDocument, fixturePath } from "../bench/motion-fixtures.mjs";
import { trackOf, yawBetween } from "../bench/motion-track.mjs";
import { SCENARIOS, scoreScenario } from "../bench/motion-scenarios.mjs";

const passes = rows => Object.fromEntries(rows.assertions.map(a => [a.id, a.pass]));
const withTake = (id, spec) => {
	const doc = fixtureDocument(id);
	doc.scenes.scenes[0].stage.characters[0].motionTake = { schema: "cozyclay.take.v3", rig: "y-bot-tpose", spec };
	return doc;
};
const spec = use => ({ schema: "cozyclay.motion-spec.v1", fps: 24, frames: 24, use });

test("the committed fixtures are what the builder makes", () => {
	for (const id of Object.keys(SCENARIOS)) {
		assert.deepEqual(JSON.parse(readFileSync(new URL(`../../${fixturePath(id)}`, import.meta.url), "utf8")), fixtureDocument(id), id);
	}
});

test("a fixture without a take scores nothing and says why", () => {
	const s = scoreScenario("S9", trackOf(fixtureDocument("S9")));
	assert.equal(s.total, 0);
	assert.equal(s.reason, "no installed take");
});

test("S9 real compiles: the seat skill on the chair passes, standing still fails seated and facing", () => {
	const sit = passes(scoreScenario("S9", trackOf(withTake("S9", spec([{ skill: "sitInSeat", f0: 0, args: { seat: "chair-seat", floor: 0 } }])))));
	assert.deepEqual(sit, { seated: true, "feet-down": true, "facing-out": true, "no-penetration": true, "qa-no-chair-collision": true });
	const stand = passes(scoreScenario("S9", trackOf(withTake("S9", spec([{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } }])))));
	assert.equal(stand.seated, false);
	assert.equal(stand["facing-out"], false);
	// the seat skill's default floor is the seat base: its feet hang 43 cm up, and feet-down says so
	const hanging = scoreScenario("S9", trackOf(withTake("S9", spec([{ skill: "sitInSeat", f0: 0, args: { seat: "chair-seat" } }]))));
	assert.equal(passes(hanging)["feet-down"], false);
});

// ---- synthetic tracks: the event logic without a compiler -----------------------------------
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const B = (pos, half, R = I3) => ({ pos, R, half });
const yawR = deg => { const a = deg * Math.PI / 180; return [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]]; };
const far = [9, 1, 9];
function synth({ n = 60, boxes = {}, hand = () => null, sole = () => null, joint = () => null, mouth = () => [9, 1.6, 9], qa = { ok: true, total: 0, groups: [] } }) {
	const palm = (f, k) => hand(f, k) ?? far;
	return { ok: true, frames: Array.from({ length: n }, (_, i) => i), qa, palm, hand: (f, k) => [palm(f, k)], sole: (f, k) => [sole(f, k) ?? [9, 0, 9]],
		joint: (f, b) => joint(f, b) ?? far, forward: () => [0, 0, 1], mouth, boxes: (id, f) => (boxes[id] ? boxes[id](f) : []) };
}
const lerp = (a, b, u) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, u)));

test("S6 vending: press, kick, then the can falls passes; a can that moves before the kick fails both can checks", () => {
	const machine = { "vm-body": () => [B([0, 0, 3.2], [0.45, 0.925, 0.35])], "vm-kick-panel": () => [B([0, 0.3, 2.835], [0.4, 0.14, 0.015])], "vm-button-1": () => [B([-0.33, 1.25, 2.81], [0.03, 0.02, 0.0125])] };
	const run = canMoves => synth({ boxes: { ...machine,
		can: f => [B(f < canMoves ? [0.12, 0.35, 3.05] : lerp([0.12, 0.35, 3.05], [0.12, 0.15, 2.79], (f - canMoves) / 4), [0.033, 0.06, 0.033])] },
	hand: (f, k) => (k === "r" && f >= 10 && f <= 14 ? [-0.33, 1.27, 2.79] : null),
	sole: (f, k) => (k === "r" && f >= 30 && f <= 32 ? [0, 0.4, 2.81] : null) });
	const ok = passes(scoreScenario("S6", run(40)));
	assert.equal(ok.press && ok.kick && ok["can-still-before-kick"] && ok["can-falls-after-kick"] && ok["machine-stays"] && ok["no-penetration"], true, JSON.stringify(ok));
	const early = passes(scoreScenario("S6", run(20)));
	assert.equal(early["can-still-before-kick"], false);
	assert.equal(early["can-falls-after-kick"], false);
});

test("S7 door: a touch, then the door turns 90 degrees and the hips pass; a door that turns before the touch fails", () => {
	const wall = () => [B([-1.5, 0, 2.5], [1.05, 1.2, 0.06]), B([1.5, 0, 2.5], [1.05, 1.2, 0.06])];
	const run = turnsAt => synth({ boxes: { wall, "wall-left": () => [wall()[0]], "wall-right": () => [wall()[1]],
		door: f => [B([0, 0.01, 2.5], [0.44, 1.035, 0.02], yawR(f < turnsAt ? 0 : Math.min(90, (f - turnsAt) * 6)))] },
	hand: (f, k) => (k === "r" && f >= 10 && f <= 12 ? [0.2, 1.1, 2.47] : null),
	joint: (f, b) => (b === "Hips" ? [0, 0.95, f < 50 ? 1.5 : 3.2] : null) });
	const ok = passes(scoreScenario("S7", run(12)));
	assert.equal(ok.touch && ok["door-still-before-touch"] && ok["door-opens"] && ok.through && ok["wall-stays"], true, JSON.stringify(ok));
	assert.equal(passes(scoreScenario("S7", run(5)))["door-still-before-touch"], false);
	assert.equal(yawBetween(I3, yawR(75)) > 74.9, true);
});

test("S8 cup: grasp, lift to the mouth and put back passes; a cup that moves before the hand fails grasp and still-before", () => {
	const top = () => [B([0, 0.72, 1.4], [0.5, 0.02, 0.3])], rest = [-0.15, 0.76, 1.22], up = [-0.1, 1.3, 0.2];
	const cupAt = moves => f => (f < moves ? rest : f < 30 ? lerp(rest, up, (f - moves) / 8) : f < 40 ? up : lerp(up, rest, (f - 40) / 8));
	const run = moves => { const at = cupAt(moves); return synth({ boxes: { "table-top": top, table: top, cup: f => [B(at(f), [0.04, 0.05, 0.04])] },
		hand: (f, k) => (k === "r" && f >= 18 && f <= 48 ? [at(f)[0], at(f)[1] + 0.05, at(f)[2] - 0.06] : null), mouth: () => [-0.1, 1.42, 0.2] }); };
	const ok = passes(scoreScenario("S8", run(20)));
	assert.deepEqual(ok, { grasp: true, "still-before-grasp": true, lifted: true, sip: true, "put-back": true, "cup-not-into-table": true, "hands-not-into-table": true });
	const early = passes(scoreScenario("S8", run(10)));
	assert.equal(early.grasp, false);
	assert.equal(early["still-before-grasp"], false);
});

test("S10 box: both palms carry it onto the table; one palm only fails the two-hand checks", () => {
	const top = () => [B([0, 0.72, 2.4], [0.5, 0.02, 0.3])], rest = [0, 0, 1.0], onTop = [0, 0.761, 2.3];
	const lifted = [0, 0.9, 1.0], over = [0, 0.9, 2.3];
	const boxAt = f => (f < 15 ? rest : f < 25 ? lerp(rest, lifted, (f - 15) / 10) : f < 35 ? lerp(lifted, over, (f - 25) / 10) : lerp(over, onTop, (f - 35) / 5));
	const run = twoHands => synth({ boxes: { "table-top": top, table: top, box: f => [B(boxAt(f), [0.2, 0.15, 0.15])] },
		hand: (f, k) => ((k === "r" || twoHands) && f >= 10 && f <= 40 ? [k === "l" ? 0.22 : -0.22, boxAt(f)[1] + 0.15, boxAt(f)[2]] : null) });
	const ok = passes(scoreScenario("S10", run(true)));
	assert.deepEqual(ok, { "two-hand-grasp": true, "still-before-grasp": true, "carried-with-both": true, "on-table": true, "not-into-table": true, "not-into-floor": true });
	const one = passes(scoreScenario("S10", run(false)));
	assert.equal(one["two-hand-grasp"], false);
	assert.equal(one["carried-with-both"], false);
});
