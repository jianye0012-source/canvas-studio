// The interaction bench's scenarios S6-S10 (docs/qa/agent-bench.md): a pre-built set (objects with fixed ids,
// world coordinates, base pivot at the bottom centre; the character stands at the origin facing +Z), the
// one-line request a user types, and the atomic assertions we wrote, each tagged cause, contact, effect or
// negative. Every assertion finds its events in the take (the first fingertip on a button, the first foot on
// the panel, the first frame the cup moves): no frame of the agent's plan is assumed.
import { anchorPoints, baseShift, corners, depthInto, dist, firstFrame, hands, longestRun, minGap, minOver, result, soles, yawBetween } from "./motion-track.mjs";

const box = (id, name, renderer, [x, y, z], [sx, sy, sz], color, parent = null, rot = 0) => ({ id, name, renderer, x, y, z, rot, scaleX: sx, scaleY: sy, scaleZ: sz, color, parent });
const group = (id, name, [x, y, z], rot = 0) => ({ id, name, renderer: "empty", x, y, z, rot, scaleX: 1, scaleY: 1, scaleZ: 1, color: "#ffffff", parent: null });
const legs = (prefix, parent, [cx, cz], [dx, dz], h, r, color, rot = 0) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b], i) => box(`${prefix}-leg-${i + 1}`, `${prefix} leg ${i + 1}`, "cylinder", [cx + a * dx, 0, cz + b * dz], [r, h, r], color, parent, rot));
const table = (z, top = 0.76) => [group("table", "Table", [0, 0, z]), box("table-top", "Table top", "cube", [0, top - 0.04, z], [1.0, 0.04, 0.6], "#8d6e63", "table"),
	...legs("table", "table", [0, z], [0.44, 0.24], top - 0.04, 0.04, "#6d4c41")];

const PALM_ON = 0.04, TOUCH = 0.03, STILL = 0.01;
const ids = (t, prefix) => (f) => prefix.flatMap(id => t.boxes(id, f));
const lastFrame = t => t.frames[t.frames.length - 1];

/** The frame any corner of an object first moves more than STILL from where it starts (a shift or a turn), or null. */
function firstMove(t, id) {
	const start = corners(t.boxes(id, t.frames[0]));
	return firstFrame(t, f => corners(t.boxes(id, f)).some((p, i) => dist(p, start[i]) > STILL));
}

/** "rests on top": the object's base at the last frame is within -0.5..+1 cm of the top and over it (inset m). */
function restsOn(t, id, topId, inset) {
	const f = lastFrame(t), o = anchorPoints(t.boxes(id, f)), top = anchorPoints(t.boxes(topId, f));
	const dy = o.base[1] - top.hi[1], over = o.base[0] > top.lo[0] + inset && o.base[0] < top.hi[0] - inset && o.base[2] > top.lo[2] + inset && o.base[2] < top.hi[2] - inset;
	return { pass: dy >= -0.005 && dy <= 0.01 && over, value: dy, frame: f, note: over ? "" : "not over the top" };
}

/** Never deeper than `limit` into the boxes of `boxIds`: the deepest of points(f) over the take. */
function neverInto(t, points, boxIds, limit) {
	const deepest = minOver(t, f => -depthInto(points(f), boxIds.flatMap(id => t.boxes(id, f))));
	return { pass: -deepest.value <= limit, value: -deepest.value, frame: deepest.frame };
}

const MACHINE = ["vm-body", "vm-window", "vm-panel", "vm-button-1", "vm-button-2", "vm-button-3", "vm-kick-panel", "vm-tray", "vm-opening"];
const BUTTONS = ["vm-button-1", "vm-button-2", "vm-button-3"];

function vending(t) {
	const press = firstFrame(t, f => minGap(hands(t, f), ids(t, BUTTONS)(f)) <= TOUCH);
	const low = f => soles(t, f).filter(p => p[1] >= 0.15 && p[1] < 0.7);
	const kick = press === null ? null : firstFrame(t, f => low(f).length > 0 && minGap(low(f), ids(t, ["vm-kick-panel", "vm-body"])(f)) <= TOUCH, press + 1);
	const move = firstMove(t, "can");
	const deep = neverInto(t, f => [...soles(t, f), ...hands(t, f)], MACHINE, 0.02);
	const held = move === null ? { length: 0, first: null } : longestRun(t, f => Math.min(...["l", "r"].map(k => minGap([t.palm(f, k)], t.boxes("can", f)))) <= 0.06, move + 1);
	const sip = minOver(t, f => dist(anchorPoints(t.boxes("can", f)).top, t.mouth(f)));
	const slide = minOver(t, f => -baseShift(t, "vm-body", f));
	return [
		result("press", "cause", "a fingertip within 3 cm of a button", press !== null, press === null ? minOver(t, f => minGap(hands(t, f), ids(t, BUTTONS)(f))).value : 0, press),
		result("kick", "contact", "after the press, a raised sole point (0.15-0.7 m up) within 3 cm of the machine front", kick !== null, null, kick),
		result("no-penetration", "negative", "no hand or sole point deeper than 2 cm into the machine", deep.pass, deep.value, deep.frame),
		result("can-still-before-kick", "negative", "the can stays within 1 cm of its rest point until the kick", move === null || (kick !== null && move > kick), null, move, kick === null ? "no kick" : ""),
		result("can-falls-after-kick", "effect", "the can moves within 48 frames after the kick", kick !== null && move !== null && move > kick && move <= kick + 48, move === null || kick === null ? null : move - kick, move),
		result("can-in-hand", "contact", "after it moved, the can stays within 6 cm of a palm for 12+ frames", held.length >= 12, held.length, held.first),
		result("sip", "contact", "the can top within 5 cm of the mouth at some frame", sip.value <= 0.05, sip.value, sip.frame),
		result("machine-stays", "negative", "the machine base never moves more than 2 cm", -slide.value <= 0.02, -slide.value, slide.frame),
	];
}

const WALL = ["wall-left", "wall-right", "wall-top"];

function door(t) {
	const touch = firstFrame(t, f => minGap(hands(t, f), t.boxes("door", f)) <= TOUCH);
	const move = firstMove(t, "door");
	const rest = t.boxes("door", t.frames[0])[0]?.R;
	const open = minOver(t, f => -yawBetween(rest, t.boxes("door", f)[0].R), t.frames.filter(f => touch !== null && f > touch));
	const hipsZ = t.joint(lastFrame(t), "Hips")[2], wallZ = anchorPoints(t.boxes("wall", t.frames[0])).hi[2];
	const body = f => [...hands(t, f), ...soles(t, f), ...["Hips", "Spine2", "Head"].map(b => t.joint(f, b))];
	const deep = neverInto(t, body, [...WALL, "door"], 0.02);
	const wall = minOver(t, f => -baseShift(t, "wall", f));
	return [
		result("touch", "cause", "a hand within 3 cm of the door", touch !== null, null, touch),
		result("door-still-before-touch", "negative", "the door does not move before the hand touches it", move === null || (touch !== null && move >= touch), null, move),
		result("door-opens", "effect", "after the touch the door turns 60 degrees or more", -open.value >= 60, Number.isFinite(open.value) ? -open.value : 0, open.frame),
		result("through", "effect", "the hips end past the far face of the wall", hipsZ > wallZ + 0.1, hipsZ - wallZ, lastFrame(t)),
		result("no-penetration", "negative", "no hand, sole, hips, chest or head point deeper than 2 cm into wall or door", deep.pass, deep.value, deep.frame),
		result("wall-stays", "negative", "the wall never moves", -wall.value <= STILL, -wall.value, wall.frame),
	];
}

function cup(t) {
	const touch = firstFrame(t, f => minGap(hands(t, f), t.boxes("cup", f)) <= PALM_ON);
	const move = firstMove(t, "cup");
	const top = anchorPoints(t.boxes("table-top", t.frames[0])).hi[1];
	const lift = minOver(t, f => -(anchorPoints(t.boxes("cup", f)).base[1] - top));
	const sip = minOver(t, f => dist(anchorPoints(t.boxes("cup", f)).top, t.mouth(f)));
	const on = restsOn(t, "cup", "table-top", 0.02);
	const cupIn = neverInto(t, f => corners(t.boxes("cup", f)), ["table-top"], 0.01);
	const handIn = neverInto(t, f => hands(t, f), ["table-top", "table"], 0.02);
	return [
		result("grasp", "contact", "a hand within 4 cm of the cup when it first moves", move !== null && minGap(hands(t, move), t.boxes("cup", move)) <= PALM_ON, null, move),
		result("still-before-grasp", "negative", "the cup does not move before a hand reaches it", move === null || (touch !== null && move >= touch), null, move),
		result("lifted", "effect", "the cup base rises 10 cm or more above the table", -lift.value >= 0.1, -lift.value, lift.frame),
		result("sip", "contact", "the cup top within 5 cm of the mouth at some frame", sip.value <= 0.05, sip.value, sip.frame),
		result("put-back", "effect", "the cup moved and ends resting on the table top", move !== null && on.pass, on.value, on.frame, move === null ? "never moved" : on.note),
		result("cup-not-into-table", "negative", "the cup never goes more than 1 cm into the table", cupIn.pass, cupIn.value, cupIn.frame),
		result("hands-not-into-table", "negative", "no hand point deeper than 2 cm into the table", handIn.pass, handIn.value, handIn.frame),
	];
}

const CHAIR = ["chair-seat", "chair-back", "chair-leg-1", "chair-leg-2", "chair-leg-3", "chair-leg-4"];

function chair(t) {
	const f = lastFrame(t), seat = anchorPoints(t.boxes("chair-seat", f)), hips = t.joint(f, "Hips");
	const up = hips[1] - seat.hi[1], over = hips[0] > seat.lo[0] - 0.05 && hips[0] < seat.hi[0] + 0.05 && hips[2] > seat.lo[2] - 0.05 && hips[2] < seat.hi[2] + 0.05;
	const feet = Math.max(...["l", "r"].map(k => Math.min(...t.sole(f, k).map(p => p[1]))));
	const R = t.boxes("chair-seat", f)[0].R, front = [R[0][2], 0, R[2][2]], fw = t.forward(f);
	const facing = Math.acos(Math.max(-1, Math.min(1, (fw[0] * front[0] + fw[2] * front[2]) / (Math.hypot(front[0], front[2]) || 1)))) * 180 / Math.PI;
	const body = g => [...["Hips", "Spine", "Spine2", "Neck", "Head", "LeftLeg", "RightLeg"].map(b => t.joint(g, b)), ...hands(t, g), ...soles(t, g)];
	const deep = neverInto(t, body, CHAIR, 0.02);
	const collide = (t.qa.groups ?? []).filter(g => g.kind === "COLLIDE" && CHAIR.some(id => String(g.subject).includes(id)));
	return [
		result("seated", "effect", "at the end the hips are 5-25 cm above the seat top and over it", up >= 0.05 && up <= 0.25 && over, up, f, over ? "" : "not over the seat"),
		result("feet-down", "contact", "at the end both soles are on the floor", feet <= 0.02, feet, f),
		result("facing-out", "effect", "at the end the body faces the chair's front within 30 degrees", facing <= 30, facing, f),
		result("no-penetration", "negative", "no joint, hand or sole point deeper than 2 cm into the chair", deep.pass, deep.value, deep.frame),
		result("qa-no-chair-collision", "negative", "QA reports no collision with the chair", collide.length === 0, collide.length, null),
	];
}

function boxLift(t) {
	const both = f => ["l", "r"].every(k => minGap([t.palm(f, k)], t.boxes("box", f)) <= 0.05);
	const touch = firstFrame(t, both);
	const move = firstMove(t, "box");
	const step = f => dist(anchorPoints(t.boxes("box", f)).base, anchorPoints(t.boxes("box", f - 1)).base);
	const last = move === null ? null : [...t.frames].reverse().find(f => f > t.frames[0] && step(f) > 0.002) ?? null;
	const carried = move === null || last === null ? [] : t.frames.filter(f => f >= move && f <= last);
	const held = carried.filter(f => ["l", "r"].every(k => minGap([t.palm(f, k)], t.boxes("box", f)) <= 0.06)).length;
	const on = restsOn(t, "box", "table-top", 0.05);
	const into = neverInto(t, f => corners(t.boxes("box", f)), ["table-top", "table"], 0.01);
	const floor = minOver(t, f => Math.min(...corners(t.boxes("box", f)).map(p => p[1])));
	return [
		result("two-hand-grasp", "contact", "both palms within 5 cm of the box when it first moves", move !== null && both(move), null, move),
		result("still-before-grasp", "negative", "the box does not move before both hands are on it", move === null || (touch !== null && move >= touch), null, move),
		result("carried-with-both", "contact", "both palms within 6 cm of the box on 80% of the frames it moves", carried.length > 0 && held / carried.length >= 0.8, carried.length ? held / carried.length : 0, move),
		result("on-table", "effect", "the box ends resting on the table top", on.pass, on.value, on.frame, on.note),
		result("not-into-table", "negative", "the box never goes more than 1 cm into the table", into.pass, into.value, into.frame),
		result("not-into-floor", "negative", "the box never goes more than 1 cm into the floor", floor.value >= -0.01, floor.value, floor.frame),
	];
}

/** id -> { title, prompt, objects (scene records before defaults), measure(track) -> assertion rows }. */
export const SCENARIOS = {
	S6: { title: "vending machine kick", prompt: "자판기 버튼을 눌렀는데 음료가 안 나와서 발로 한 번 차니까 캔이 떨어졌어. 캔 꺼내서 마셔줘", measure: vending, objects: [
		group("vending", "Vending machine", [0, 0, 3.2]),
		box("vm-body", "Machine body", "cube", [0, 0, 3.2], [0.9, 1.85, 0.7], "#b3202a", "vending"),
		box("vm-window", "Drink window", "cube", [0.08, 0.95, 2.835], [0.55, 0.7, 0.03], "#e8f4ff", "vending"),
		box("vm-panel", "Button panel", "cube", [-0.33, 0.95, 2.835], [0.16, 0.4, 0.03], "#2a2a2e", "vending"),
		box("vm-button-1", "Button 1", "cube", [-0.33, 1.25, 2.81], [0.06, 0.04, 0.025], "#e53935", "vending"),
		box("vm-button-2", "Button 2", "cube", [-0.33, 1.15, 2.81], [0.06, 0.04, 0.025], "#fdd835", "vending"),
		box("vm-button-3", "Button 3", "cube", [-0.33, 1.05, 2.81], [0.06, 0.04, 0.025], "#43a047", "vending"),
		box("vm-kick-panel", "Kick panel", "cube", [0, 0.3, 2.835], [0.8, 0.28, 0.03], "#3a3a40", "vending"),
		box("vm-tray", "Tray", "cube", [0.12, 0.1, 2.79], [0.42, 0.05, 0.12], "#1c1c1f", "vending"),
		box("vm-opening", "Tray opening", "cube", [0.12, 0.15, 2.844], [0.42, 0.13, 0.012], "#050505", "vending"),
		box("can", "Can", "cylinder", [0.12, 0.35, 3.05], [0.066, 0.12, 0.066], "#f2c230"),
	] },
	S7: { title: "push a door open and walk through", prompt: "문을 손으로 밀어서 열고 들어가줘", measure: door, objects: [
		group("wall", "Wall", [0, 0, 2.5]),
		box("wall-left", "Wall left", "cube", [-1.5, 0, 2.5], [2.1, 2.4, 0.12], "#d7d2c8", "wall"),
		box("wall-right", "Wall right", "cube", [1.5, 0, 2.5], [2.1, 2.4, 0.12], "#d7d2c8", "wall"),
		box("wall-top", "Wall above the door", "cube", [0, 2.1, 2.5], [0.9, 0.3, 0.12], "#d7d2c8", "wall"),
		box("door", "Door", "cube", [0, 0.01, 2.5], [0.88, 2.07, 0.04], "#7a5230"),
	] },
	S8: { title: "drink from a cup and put it back", prompt: "테이블 위 컵을 들어서 한 모금 마시고 다시 내려놔", measure: cup, objects: [
		...table(1.4),
		box("cup", "Cup", "cylinder", [-0.15, 0.76, 1.22], [0.08, 0.1, 0.08], "#f5f5f5"),
	] },
	S9: { title: "sit on a chair", prompt: "의자에 가서 앉아줘", measure: chair, objects: [
		group("chair", "Chair", [0, 0, 1.8], 180),
		box("chair-seat", "Chair seat", "cube", [0, 0.43, 1.8], [0.46, 0.04, 0.44], "#8b5a2b", "chair", 180),
		box("chair-back", "Chair back", "cube", [0, 0.47, 2.0], [0.46, 0.5, 0.04], "#8b5a2b", "chair", 180),
		...legs("chair", "chair", [0, 1.8], [0.2, 0.19], 0.43, 0.035, "#6b4423", 180),
	] },
	S10: { title: "carry a box with both hands onto a table", prompt: "바닥에 있는 상자를 두 손으로 들어서 탁자 위에 올려놔", measure: boxLift, objects: [
		box("box", "Box", "cube", [0, 0, 1.0], [0.4, 0.3, 0.3], "#a1887f"),
		...table(2.4),
	] },
};
// S6 read as past events to most agents (they only drank, run baseline-r1/r2); S6b asks for the whole scene in the present.
SCENARIOS.S6b = { ...SCENARIOS.S6, title: "vending machine kick, the whole scene asked", prompt: "자판기 버튼을 눌러도 음료가 안 나와서 발로 한 번 차면 캔이 떨어지고, 그 캔을 꺼내서 마시는 장면을 만들어줘" };

/** track -> { assertions, passed, total, byKind: { cause, contact, effect, negative: [passed, total] } }. */
export function scoreScenario(id, track) {
	const assertions = track.ok ? SCENARIOS[id].measure(track) : [];
	const byKind = {};
	for (const a of assertions) { byKind[a.kind] ??= [0, 0]; byKind[a.kind][1]++; if (a.pass) byKind[a.kind][0]++; }
	return { assertions, passed: assertions.filter(a => a.pass).length, total: assertions.length, byKind, ...(track.ok ? {} : { reason: track.reason }) };
}
