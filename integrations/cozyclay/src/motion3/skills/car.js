// Car skills, extracted from the car-exit fixture (test/motion3/fixtures/exitcar-scene.mjs).
// The choreography is written in the template car's frame: the car centred on the origin facing
// +Z, its driver door on +X, seat base at y 0.4. The skills place it from the scene: the seat
// gives the car's position and yaw, the door gives the hinge, side "r" mirrors everything.
// Tuned on the X Bot: seated heights are the template's, standing heights follow the rig.
import { add, sub, apply, ry } from "../compiler/math.js";
import { keyBook, identityFrame, placeChannel, placeDir, sceneBox, skillError, yawOf, swapSide } from "./book.js";

const SEAT_REF = [0.54, 0.4, -0.075], FLOOR = 0.4, X_HIPS = 1.0427487182617188;
const SIDES = new Set(["l", "r"]);

/** Seat, door and handle ids from args ({ car: "Car" } fills the template's names). */
function carIds(args, side = "l") {
	const car = args.car;
	return {
		seat: args.seat ?? (car && `${car}_Seat_Driver`), seatBack: args.seatBack ?? (car && `${car}_Seat_Driver_Back`),
		door: args.door ?? (car && `${car}_Door_${side.toUpperCase()}`), handle: args.handle ?? (car && `${car}_Door_Handle`),
		wheel: args.wheel ?? (car && `${car}_Steering_Wheel`),
	};
}

/** The template-to-scene frame for a car whose driver seat is `seat`. */
function carFrame(ctx, seat, side) {
	const box = sceneBox(ctx, "seat", seat);
	if (Math.abs(box.pos[1] - FLOOR) > 0.05) skillError(ctx.tag, `seat "${seat}" stands at y ${box.pos[1]}; the car skills are tuned for a seat base at y ${FLOOR} (a car on the ground)`);
	const fr = identityFrame();
	fr.yaw = yawOf(box.R); fr.mirror = side === "r";
	const o = sub(box.pos, apply(ry(fr.yaw), fr.mirror ? [-SEAT_REF[0], SEAT_REF[1], SEAT_REF[2]] : SEAT_REF));
	fr.origin = [o[0], 0, o[2]];
	fr.names = { lthigh: "rthigh", rthigh: "lthigh" };
	return fr;
}

/** The hands on the thighs, pushing to stand up; letting go as the thighs turn under them, the palms and forearms
 * sweep a few centimetres into them for a few frames (the open case of fix/self.js: it moves wrists, not palms);
 * the hands, both on the thighs over knees close together, touch. */
const THIGH_CONTACT = [["hand", "thigh*", 0.07], ["farm", "thigh*", 0.07], ["hand", "hips", 0.07], ["farm", "hips", 0.07], ["hand_l", "hand_r", 0.035]]
	.map(([part, object, depth]) => ({ part, object, depth }));

const rigHeights = sk => ({ A: sk.restWorldPos[sk.index.LeftFoot][1], H: y => y + (sk.restWorldPos[sk.index.Hips][1] - X_HIPS) });

/** sitInSeat({ car | seat (+ seatBack, wheel), offset = [0, 0.17, 0.02], floor }): seated, hands forward at the wheel. */
export function sitInSeat(ctx) {
	const { args, sk } = ctx, ids = carIds(args), box = sceneBox(ctx, "seat", ids.seat), { A } = rigHeights(sk);
	const Y = yawOf(box.R), turn = v => apply(ry(Y), v), off = args.offset ?? [0, 0.17, 0.02], floor = args.floor ?? box.pos[1];
	const root = add(add(box.pos, apply(box.R, [0, 2 * box.half[1], 0])), turn(off));
	const foot = x => { const p = add(root, turn([x, 0, 0.452])); p[1] = floor + A; return p; };
	const hand = x => add(root, turn([x, 0.348, 0.324]));
	const set = {
		root, yaw: Y, pitch: 0, spine_pitch: -12, spine_yaw: 0, spine_roll: 0, head_yaw: 0, head_pitch: 10,
		foot_l: foot(0.17), foot_r: foot(-0.17), fyaw_l: Y, fyaw_r: Y, fpitch_l: 0, fpitch_r: 0, knee_l: [0.15, 0.2, 1], knee_r: [-0.15, 0.2, 1],
		armw_l: 1, armw_r: 1, hand_l: hand(0.22), hand_r: hand(-0.22), elbow_l: [0.6, -1, -0.3], elbow_r: [-0.6, -1, -0.3],
		aswing_l: 0, aswing_r: 0, abend_l: 0, abend_r: 0, wtwist_l: 0, wtwist_r: 0, wflex_l: 0, wflex_r: 0,
	};
	const allow = [{ part: "torso_lo", object: ids.seat, depth: 0.04 }, { part: "hips", object: ids.seat, depth: 0.04 }, { part: "thigh", object: ids.seat, depth: 0.045 }];
	if (ids.seatBack && ctx.scene.objects[ids.seatBack]) allow.push({ part: "torso", object: ids.seatBack, depth: 0.03 });
	if (ids.wheel && ctx.scene.objects[ids.wheel]) allow.push({ part: "hand", object: ids.wheel, depth: 0.05 });
	return { keys: [{ f: ctx.f0, set }], checks: { supports: [{ object: ids.seat, part: "hips", tol: 0.04 }], allow }, end: ctx.f0 };
}

/**
 * exitCar({ car | seat+door+handle, side = "l", channel = "door" }): reach the inner handle, pull
 * and push the door, let it swing open, swivel, legs out, stand up with the hands on the thighs,
 * two steps away; ends at f0 + 246 standing on a walk start stance heading car yaw + 125.
 */
export function exitCar(ctx) {
	const side = ctx.args.side ?? "l";
	if (!SIDES.has(side)) skillError(ctx.tag, `args.side must be "l" or "r", got ${JSON.stringify(side)}`);
	const ids = carIds(ctx.args, side), fr = carFrame(ctx, ids.seat, side), ch = ctx.args.channel ?? "door";
	for (const [arg, id] of [["door", ids.door], ["handle", ids.handle]]) sceneBox(ctx, arg, id);
	fr.negate.add(ch);
	const defaults = { [ch]: 0, w_handle_l: 0, w_lthigh_l: 0, w_rthigh_r: 0, fingers_l: { grip: 0, fist: 0 } };
	const k = keyBook(ctx.state, ctx.f0, fr), fresh = {};
	for (const [c, v] of Object.entries(defaults)) if (ctx.state[placeChannel(fr, c)] === undefined) fresh[c] = v;
	if (Object.keys(fresh).length) k.at(0, fresh);
	choreography(k, ch, rigHeights(ctx.sk));
	const door = ctx.scene.objects[ids.door], hx = (fr.mirror ? -1 : 1) * door.half[0];
	const hinge = { pivot: add(door.pos, apply(door.R, [hx, 0, door.half[2]])), axis: [0, 1, 0], channel: ch };
	const L = s => (fr.mirror ? swapSide(s) : s), n = s => (fr.mirror ? { lthigh: "rthigh", rthigh: "lthigh" }[s] ?? s : s);
	const seg = (S, reach) => ({ kind: "segment", from: L(`${S}UpLeg`), to: L(`${S}Leg`), t: 0.45, tMin: 0.15, offset: [0, 0.07, 0], reach: fr.mirror ? (reach === "l" ? "r" : "l") : reach });
	const hand = fr.mirror ? "r" : "l";
	return {
		keys: k.keys,
		objects: { [ids.door]: hinge, [ids.handle]: hinge },
		anchors: { handle: { kind: "object", object: ids.handle, local: placeDir(fr, [-0.005, 0.015, 0]) }, [n("lthigh")]: seg("Left", "l"), [n("rthigh")]: seg("Right", "r") },
		props: { grip: { hand, origin: [L("LeftHandIndex2"), L("LeftHandMiddle2")], points: { fingers: [0, 0, 0] } } },
		fits: [{ side: hand, anchor: "handle", effector: { prop: "grip", point: "fingers" } }],
		checks: {
			contacts: [{ name: "fingers on the door handle", point: "prop:grip.fingers", target: "anchor:handle", tol: 0.04, when: `w_handle_${hand}` }],
			// the hands rest on the thighs and push on them to stand up: a contact the body check allows (qa/body-checks.js)
			allow: [{ part: "hand", object: ids.door, depth: 0.03 }, { part: "hand", object: ids.handle, depth: 0.04 }, ...THIGH_CONTACT],
		},
		end: ctx.f0 + 246,
	};
}

function choreography(k, door, { A, H }) {
	// 1. reach for the inner handle, pull, push the door a little (f12-50)
	k.hold(12, "w_handle_l", "fingers_l", "head_yaw", "spine_yaw", "spine_roll", "elbow_l", "hand_l");
	k.at(32, { w_handle_l: 1, fingers_l: { grip: 1, fist: 0 }, head_yaw: 35, spine_yaw: 10, spine_roll: -8, elbow_l: [0.3, -1, -0.6], hand_l: [1.0, 0.96, 0.06] });
	k.hold(32, door);
	k.at(38, { [door]: -3 });
	k.at(50, { [door]: -10, spine_roll: -16, spine_yaw: 14 });
	// 2. let go (the door holds still), then it swings open; hands rest on the thighs (f54-84)
	k.hold(54, "w_handle_l", "fingers_l", "w_lthigh_l", "elbow_l", door);
	k.at(66, { w_handle_l: 0, fingers_l: { grip: 0, fist: 0 }, [door]: -10 });
	k.at(70, { w_lthigh_l: 1, elbow_l: [0.5, -0.3, -1], spine_roll: -3, spine_yaw: 6 });
	k.at(84, { [door]: -68, head_yaw: 40 });
	k.hold(64, "w_rthigh_r", "elbow_r", "spine_pitch");
	k.at(80, { w_rthigh_r: 1, elbow_r: [-0.5, -0.3, -1], spine_roll: 0, spine_yaw: 0, spine_pitch: 0 });
	// 3. swivel; the left leg goes out over the sill and down to the ground (f84-118)
	k.hold(84, "yaw", "root", "foot_l", "foot_r", "fyaw_l", "fyaw_r", "knee_l", "knee_r");
	k.at(92, { foot_r: [0.4, FLOOR + A + 0.03, 0.36], fyaw_r: 15 });
	k.at(97, { foot_l: [0.96, FLOOR + 0.22, 0.32], fyaw_l: 40, knee_l: [0.5, 0.4, 1], yaw: 30, root: [0.64, 0.915, -0.06] });
	k.at(101, { foot_r: [0.56, FLOOR + A, 0.34], fyaw_r: 35 });
	k.at(105, { foot_l: [1.18, FLOOR + 0.1, 0.1], fyaw_l: 60 });
	k.at(116, { foot_l: [1.28, A, -0.12], fyaw_l: 75, knee_l: [0.4, 0.5, 1], yaw: 62, root: [0.82, 0.9, -0.06], head_yaw: 20, knee_r: [0.1, 0.6, 1], spine_pitch: 10 });
	// 4. right leg out (f120-144)
	k.hold(120, "foot_r", "fyaw_r");
	k.at(129, { foot_r: [0.94, FLOOR + 0.24, 0.36], fyaw_r: 65, knee_r: [0, 0.5, 1], yaw: 80, root: [0.86, 0.9, -0.03] });
	k.at(135, { foot_r: [1.18, FLOOR + 0.1, 0.26], fyaw_r: 85 });
	k.hold(142, "foot_l", "fyaw_l");
	k.at(144, { foot_r: [1.29, A, 0.22], fyaw_r: 90, knee_r: [-0.1, 0.4, 1], yaw: 90, root: [0.88, 0.9, 0.02], head_yaw: 0, knee_l: [0.1, 0.4, 1], spine_pitch: 16 });
	// 5. lean the weight over the feet with the hands pushing on the thighs, stand up (f144-196)
	k.hold(144, "head_pitch", "pitch", "elbow_l", "elbow_r");
	k.at(152, { spine_pitch: 28, head_pitch: -8, root: [0.91, 0.9, 0.02], elbow_l: [0.6, -0.2, -1], elbow_r: [-0.6, -0.2, -1] });
	k.at(162, { spine_pitch: 50, pitch: 22, head_pitch: -36, root: [0.99, 0.91, 0.02] });
	k.at(174, { root: [1.09, 0.96, 0.02], spine_pitch: 36, pitch: 12, head_pitch: -24 });
	k.hold(166, "armw_l", "armw_r");
	k.at(186, { root: [1.19, H(1.0), 0.02], spine_pitch: 12, pitch: 3, head_pitch: -8, armw_l: 0, armw_r: 0 });
	k.hold(187, "w_lthigh_l", "w_rthigh_r");
	k.at(190, { w_lthigh_l: 0, w_rthigh_r: 0 });
	k.at(196, { root: [1.21, H(1.005), 0.02], spine_pitch: 0, pitch: 0, head_pitch: 0 });
	// 6. two steps away from the car with a weight shift (f196-246), onto the walk's start stance
	k.at(205, { root: [1.26, H(0.985), 0.165] });
	k.hold(208, "foot_l", "fyaw_l");
	k.at(212, { root: [1.3, H(0.985), 0.16] });
	k.at(214, { foot_l: [1.4, A + 0.06, -0.12] });
	k.at(220, { foot_l: [1.535, A, -0.132], fyaw_l: 110, root: [1.38, H(0.98), 0.05] });
	k.at(230, { root: [1.5, H(0.975), -0.08] });
	k.hold(232, "foot_r", "fyaw_r");
	k.at(236, { root: [1.52, H(0.975), -0.085] });
	k.at(239, { foot_r: [1.53, A + 0.07, 0.09] });
	k.at(246, { foot_r: [1.765, A, -0.048], fyaw_r: 125, yaw: 110, root: [1.62, H(0.98), -0.08] });
}
