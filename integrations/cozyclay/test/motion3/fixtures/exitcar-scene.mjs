// P6 acceptance fixture: an X Bot seated in a convertible opens the driver door, gets out,
// walks away, takes out a cigarette, lights it and smokes (730 frames at 24 fps).
// SCENE_OBJECTS are Studio scene object records (what motionScene() reads); EXITCAR_SPEC is
// the cozyclay.motion-spec.v1 an agent writes for it. Units: metres, +Y up, the car is
// centred on the origin facing +Z and the driver door (left side) is at +X.

// [id, x, y, z (base pivot = bottom centre), rotX, rotZ, scaleX, scaleY, scaleZ] of 1 m cubes
const BOXES = [
	["Car_Chassis", 0, 0.22, 0, 0, 0, 2.16, 0.18, 5.2],
	["Car_Hood", 0, 0.4, 1.675, 0, 0, 2.24, 0.6, 1.85],
	["Car_Trunk", 0, 0.4, -1.875, 0, 0, 2.24, 0.6, 1.45],
	["Car_Door_L", 1.08, 0.4, -0.2, 0, 0, 0.08, 0.6, 1.9],
	["Car_Door_R", -1.08, 0.4, -0.2, 0, 0, 0.08, 0.6, 1.9],
	["Car_Door_Handle", 1.025, 0.885, 0, 0, 0, 0.03, 0.03, 0.12],
	["Car_Dashboard", 0, 0.95, 0.625, 0, 0, 2.08, 0.23, 0.25],
	["Car_Seat_Driver", 0.54, 0.4, -0.075, 0, 0, 0.64, 0.35, 0.55],
	["Car_Seat_Driver_Back", 0.48, 0.75, -0.38, -12.03, 0, 0.52, 0.62, 0.12],
	["Car_Seat_Passenger", -0.48, 0.4, -0.075, 0, 0, 0.52, 0.35, 0.55],
	["Car_Seat_Passenger_Back", -0.48, 0.75, -0.38, -12.03, 0, 0.52, 0.62, 0.12],
	["Car_Seat_Rear", 0, 0.4, -0.85, 0, 0, 1.8, 0.38, 0.5],
	["Car_Seat_Rear_Back", 0, 0.78, -1.07, -9.74, 0, 1.8, 0.5, 0.1],
	["Car_Steering_Wheel", 0.48, 1.2593, 0.3704, -65, 0, 0.4406, 0.04, 0.4406],
	["Car_Steering_Column", 0.48, 1.0632, 0.7335, -65, 0, 0.05, 0.4, 0.05],
	["Car_Pillar_L", 1.04, 1.18, 0.75, -29.79, 0, 0.05, 0.45, 0.05],
	["Car_Pillar_R", -1.04, 1.18, 0.75, -29.79, 0, 0.05, 0.45, 0.05],
	["Car_Windshield_Top", 0, 1.55, 0.54, 0, 0, 2.13, 0.05, 0.05],
	["Car_Light_L", 0.75, 0.78, 2.58, 90, 0, 0.22, 0.04, 0.22],
	["Car_Light_R", -0.75, 0.78, 2.58, 90, 0, 0.22, 0.04, 0.22],
	["Car_Taillight_L", 0.8, 0.82, -2.605, 0, 0, 0.35, 0.08, 0.02],
	["Car_Taillight_R", -0.8, 0.82, -2.605, 0, 0, 0.35, 0.08, 0.02],
	["Car_Wheel_FL", 1.15, 0.42, 1.7, 0, 90, 0.84, 0.3, 0.84],
	["Car_Wheel_FR", -0.85, 0.42, 1.7, 0, 90, 0.84, 0.3, 0.84],
	["Car_Wheel_RL", 1.15, 0.42, -1.75, 0, 90, 0.84, 0.3, 0.84],
	["Car_Wheel_RR", -0.85, 0.42, -1.75, 0, 90, 0.84, 0.3, 0.84],
];

export const SCENE_OBJECTS = BOXES.map(([id, x, y, z, rotX, rotZ, scaleX, scaleY, scaleZ]) => ({
	id, name: id.replaceAll("_", " "), renderer: "cube", x, y, z, rot: 0, rotX, rotZ, scaleX, scaleY, scaleZ,
	footprint: { width: 1, depth: 1 }, height: 1,
}));

export const CHARACTER = { id: "driver", model: "x-bot-tpose", subject: "Driver", x: 0, y: 0, z: 0, rot: 0, scale: 1 };

// ---- keys ------------------------------------------------------------------------------
const FRAMES = 730, FLOOR = 0.4, ANK = 0.087;
const SEATED = {
	root: [0.48, 0.92, -0.052], yaw: 0, pitch: 0, spine_pitch: -12, spine_yaw: 0, spine_roll: 0, head_yaw: 0, head_pitch: 10,
	foot_l: [0.65, FLOOR + ANK, 0.4], foot_r: [0.31, FLOOR + ANK, 0.4], fyaw_l: 0, fyaw_r: 0, fpitch_l: 0, fpitch_r: 0,
	knee_l: [0.15, 0.2, 1], knee_r: [-0.15, 0.2, 1],
	armw_l: 1, armw_r: 1, hand_l: [0.7, 1.268, 0.272], hand_r: [0.26, 1.268, 0.272], elbow_l: [0.6, -1, -0.3], elbow_r: [-0.6, -1, -0.3],
	door: 0, w_handle_l: 0, w_lthigh_l: 0, w_rthigh_r: 0, aswing_l: 0, aswing_r: 0, abend_l: 0, abend_r: 0,
	w_lpocket_l: 0, w_rpocket_r: 0, w_hold_r: 0, w_mouth_r: 0, w_flame_l: 0,
	wtwist_l: 0, wtwist_r: 0, wflex_l: 0, wflex_r: 0, fingers_l: { grip: 0, fist: 0 }, fingers_r: { cigarette: 0 },
	cig_vis: 0, lit_vis: 0, flame_vis: 0, ember_vis: 0,
};

function keyBook(base) {
	const state = structuredClone(base), keys = [{ f: 0, set: structuredClone(base) }];
	return {
		state, keys,
		at(f, set) { Object.assign(state, structuredClone(set)); keys.push({ f, set: structuredClone(set) }); },
		hold(f, ...names) { keys.push({ f, set: Object.fromEntries(names.map(n => [n, structuredClone(state[n])])) }); },
		step(f, ch, value) { keys.push({ f: f - 1, set: { [ch]: state[ch] } }); state[ch] = value; keys.push({ f, set: { [ch]: value }, step: [ch] }); },
	};
}

function exitCar(k) {
	// 1. reach for the inner handle, pull, push the door a little (f12-50)
	k.hold(12, "w_handle_l", "fingers_l", "head_yaw", "spine_yaw", "spine_roll", "elbow_l", "hand_l");
	k.at(32, { w_handle_l: 1, fingers_l: { grip: 1, fist: 0 }, head_yaw: 35, spine_yaw: 10, spine_roll: -8, elbow_l: [0.3, -1, -0.6], hand_l: [1.0, 0.96, 0.06] });
	k.hold(32, "door");
	k.at(38, { door: -3 });
	k.at(50, { door: -10, spine_roll: -16, spine_yaw: 14 });
	// 2. let go (the door holds still), then it swings open; hands rest on the thighs (f54-84)
	k.hold(54, "w_handle_l", "fingers_l", "w_lthigh_l", "elbow_l", "door");
	k.at(66, { w_handle_l: 0, fingers_l: { grip: 0, fist: 0 }, door: -10 });
	k.at(70, { w_lthigh_l: 1, elbow_l: [0.5, -0.3, -1], spine_roll: -3, spine_yaw: 6 });
	k.at(84, { door: -68, head_yaw: 40 });
	k.hold(64, "w_rthigh_r", "elbow_r", "spine_pitch");
	k.at(80, { w_rthigh_r: 1, elbow_r: [-0.5, -0.3, -1], spine_roll: 0, spine_yaw: 0, spine_pitch: 0 });
	// 3. swivel; the left leg goes out over the sill and down to the ground (f84-118)
	k.hold(84, "yaw", "root", "foot_l", "foot_r", "fyaw_l", "fyaw_r", "knee_l", "knee_r");
	k.at(92, { foot_r: [0.4, FLOOR + ANK + 0.03, 0.36], fyaw_r: 15 });
	k.at(97, { foot_l: [0.96, FLOOR + 0.22, 0.32], fyaw_l: 40, knee_l: [0.5, 0.4, 1], yaw: 30, root: [0.64, 0.915, -0.06] });
	k.at(101, { foot_r: [0.56, FLOOR + ANK, 0.34], fyaw_r: 35 });
	k.at(105, { foot_l: [1.18, FLOOR + 0.1, 0.1], fyaw_l: 60 });
	k.at(116, { foot_l: [1.28, ANK, -0.12], fyaw_l: 75, knee_l: [0.4, 0.5, 1], yaw: 62, root: [0.82, 0.9, -0.06],
		head_yaw: 20, knee_r: [0.1, 0.6, 1], spine_pitch: 10 });
	// 4. right leg out (f120-144)
	k.hold(120, "foot_r", "fyaw_r");
	k.at(129, { foot_r: [0.94, FLOOR + 0.24, 0.36], fyaw_r: 65, knee_r: [0, 0.5, 1], yaw: 80, root: [0.86, 0.9, -0.03] });
	k.at(135, { foot_r: [1.18, FLOOR + 0.1, 0.26], fyaw_r: 85 });
	k.hold(142, "foot_l", "fyaw_l");
	k.at(144, { foot_r: [1.29, ANK, 0.22], fyaw_r: 90, knee_r: [-0.1, 0.4, 1], yaw: 90, root: [0.88, 0.9, 0.02], head_yaw: 0,
		knee_l: [0.1, 0.4, 1], spine_pitch: 16 });
	// 5. lean the weight over the feet with the hands pushing on the thighs, stand up (f144-196)
	k.hold(144, "head_pitch", "pitch", "elbow_l", "elbow_r");
	k.at(152, { spine_pitch: 28, head_pitch: -8, root: [0.91, 0.9, 0.02], elbow_l: [0.6, -0.2, -1], elbow_r: [-0.6, -0.2, -1] });
	k.at(162, { spine_pitch: 50, pitch: 22, head_pitch: -36, root: [0.99, 0.91, 0.02] });
	k.at(174, { root: [1.09, 0.96, 0.02], spine_pitch: 36, pitch: 12, head_pitch: -24 });
	k.hold(166, "armw_l", "armw_r");
	k.at(186, { root: [1.19, 1.0, 0.02], spine_pitch: 12, pitch: 3, head_pitch: -8, armw_l: 0, armw_r: 0 });
	k.hold(187, "w_lthigh_l", "w_rthigh_r");
	k.at(190, { w_lthigh_l: 0, w_rthigh_r: 0 });
	k.at(196, { root: [1.21, 1.005, 0.02], spine_pitch: 0, pitch: 0, head_pitch: 0 });
	// 6. two steps away from the car with a weight shift (f196-246)
	k.at(205, { root: [1.26, 0.985, 0.165] });
	k.hold(208, "foot_l", "fyaw_l");
	k.at(212, { root: [1.3, 0.985, 0.16] });
	k.at(214, { foot_l: [1.4, ANK + 0.06, -0.12] });
	// the feet land on the walk's own start stance: path centre (1.65, -0.09), heading 125, half width 0.1
	k.at(220, { foot_l: [1.535, ANK, -0.132], fyaw_l: 110, root: [1.38, 0.98, 0.05] });
	k.at(230, { root: [1.5, 0.975, -0.08] });
	k.hold(232, "foot_r", "fyaw_r");
	k.at(236, { root: [1.52, 0.975, -0.085] });
	k.at(239, { foot_r: [1.53, ANK + 0.07, 0.09] });
	k.at(246, { foot_r: [1.765, ANK, -0.048], fyaw_r: 125, yaw: 110, root: [1.62, 0.98, -0.08] });
}

// Hips where the walk generator leaves them (read back with motion.sample after a first compile).
const WALK_END_ROOT = [3.4537, 1.0231, -3.0387];
const WALK_END_YAW = 150;
// Wrist twist / flex per hand pose (degrees), found by sweeping them against the QA checks.
const WR = { TW_M: 40, FX_M: 0, TW_H: 0, FX_H: 10, TW_L: -80, FX_L: -50 };
const EL_MOUTH_R = [0.4, -1, 0.6], EL_HOLD_R = [-0.4, -1, -0.3], EL_LIGHT_L = [0.9, -0.6, 0.3];

function smoke(k, s0) {
	const all = ["armw_r", "armw_l", "w_rpocket_r", "w_lpocket_l", "w_hold_r", "w_mouth_r", "w_flame_l", "elbow_r", "elbow_l",
		"wtwist_r", "wflex_r", "wtwist_l", "wflex_l", "head_pitch", "head_yaw", "spine_pitch", "root", "fingers_l", "fingers_r",
		"cig_vis", "lit_vis", "flame_vis", "ember_vis"];
	k.state.root = WALK_END_ROOT; k.state.yaw = WALK_END_YAW; k.state.head_yaw = 0;
	k.hold(s0, ...all);
	// right hand: pocket -> the cigarette appears -> mouth
	k.at(s0 + 2, { w_rpocket_r: 1, elbow_r: [-0.5, -0.4, -1] });   // the arm is still FK here
	k.hold(s0 + 6, "armw_r", "w_rpocket_r", "elbow_r", "fingers_r");
	k.at(s0 + 20, { armw_r: 1 });
	k.at(s0 + 28, { fingers_r: { cigarette: 1 } });
	k.step(s0 + 28, "cig_vis", 1);
	k.hold(s0 + 36, "w_rpocket_r", "w_mouth_r", "wtwist_r", "wflex_r", "elbow_r", "head_pitch");
	k.at(s0 + 58, { w_rpocket_r: 0, w_mouth_r: 1, wtwist_r: WR.TW_M, wflex_r: WR.FX_M, elbow_r: EL_MOUTH_R, head_pitch: 6 });
	// left hand: pocket -> the lighter appears -> under the cigarette tip
	k.at(s0 + 2, { w_lpocket_l: 1, elbow_l: [0.5, -0.4, -1] });
	k.hold(s0 + 12, "armw_l", "w_lpocket_l", "elbow_l", "fingers_l");
	k.at(s0 + 26, { armw_l: 1 });
	k.at(s0 + 34, { fingers_l: { grip: 0, fist: 1 } });
	k.step(s0 + 35, "lit_vis", 1);
	k.hold(s0 + 44, "w_lpocket_l", "w_flame_l", "wtwist_l", "wflex_l", "elbow_l");
	k.at(s0 + 60, { w_lpocket_l: 0, w_flame_l: 1, wtwist_l: WR.TW_L, wflex_l: WR.FX_L, elbow_l: EL_LIGHT_L });
	// light it: flame on, the ember appears, inhale
	k.step(s0 + 63, "flame_vis", 1);
	k.step(s0 + 73, "ember_vis", 1);
	k.step(s0 + 79, "flame_vis", 0);
	// the left hand puts the lighter back and drops
	k.hold(s0 + 80, "w_flame_l", "w_lpocket_l", "wtwist_l", "wflex_l", "elbow_l");
	k.at(s0 + 96, { w_flame_l: 0, w_lpocket_l: 1, wtwist_l: 0, wflex_l: 0, elbow_l: [0.5, -0.4, -1] });
	k.hold(s0 + 101, "fingers_l");
	k.step(s0 + 102, "lit_vis", 0);
	k.hold(s0 + 104, "armw_l", "w_lpocket_l");
	k.at(s0 + 112, { fingers_l: { grip: 0, fist: 0 } });
	k.at(s0 + 120, { armw_l: 0, w_lpocket_l: 1 });
	k.at(s0 + 123, { w_lpocket_l: 0 });
	// the right hand lowers to the holding position; exhale with the head up
	k.hold(s0 + 92, "w_mouth_r", "w_hold_r", "wtwist_r", "wflex_r", "elbow_r", "head_pitch");
	k.at(s0 + 114, { w_mouth_r: 0, w_hold_r: 1, wtwist_r: WR.TW_H, wflex_r: WR.FX_H, elbow_r: EL_HOLD_R, head_pitch: 0 });
	k.at(s0 + 124, { head_pitch: -14 });
	k.at(s0 + 140, { head_pitch: 0 });
	// idle: weight onto the left leg, look around
	const lv = [Math.cos(WALK_END_YAW * Math.PI / 180), 0, -Math.sin(WALK_END_YAW * Math.PI / 180)];
	k.hold(s0 + 120, "root", "head_yaw");
	k.at(s0 + 146, { root: WALK_END_ROOT.map((v, i) => v + 0.03 * lv[i] - (i === 1 ? 0.005 : 0)), head_yaw: -22 });
	k.at(s0 + 168, { head_yaw: 0 });
	// second drag
	k.hold(s0 + 170, "w_mouth_r", "w_hold_r", "wtwist_r", "wflex_r", "elbow_r", "head_pitch", "root");
	k.at(s0 + 194, { w_mouth_r: 1, w_hold_r: 0, wtwist_r: WR.TW_M, wflex_r: WR.FX_M, elbow_r: EL_MOUTH_R, head_pitch: 6, root: WALK_END_ROOT });
	k.hold(s0 + 212, "w_mouth_r", "w_hold_r", "wtwist_r", "wflex_r", "elbow_r", "head_pitch");
	k.at(s0 + 236, { w_mouth_r: 0, w_hold_r: 1, wtwist_r: WR.TW_H, wflex_r: WR.FX_H, elbow_r: EL_HOLD_R, head_pitch: 0 });
	k.at(s0 + 246, { head_pitch: -14 });
	k.at(s0 + 264, { head_pitch: 0 });
	k.hold(s0 + 289, ...all);
}

const book = keyBook(SEATED);
exitCar(book);
smoke(book, 440);

const HINGE = [1.12, 0.4, 0.75];
export const EXITCAR_SPEC = {
	schema: "cozyclay.motion-spec.v1", fps: 24, frames: FRAMES, label: "Get out of the convertible and smoke",
	keys: book.keys,
	objects: { Car_Door_L: { pivot: HINGE, axis: [0, 1, 0], channel: "door" }, Car_Door_Handle: { pivot: HINGE, axis: [0, 1, 0], channel: "door" } },
	anchors: {
		handle: { kind: "object", object: "Car_Door_Handle", local: [-0.005, 0.015, 0] },
		lthigh: { kind: "segment", from: "LeftUpLeg", to: "LeftLeg", t: 0.45, tMin: 0.15, offset: [0, 0.07, 0], reach: "l" },
		rthigh: { kind: "segment", from: "RightUpLeg", to: "RightLeg", t: 0.45, tMin: 0.15, offset: [0, 0.07, 0], reach: "r" },
		lpocket: { kind: "body", p: [0.13, -0.035, 0.08] },
		rpocket: { kind: "body", p: [-0.13, -0.035, 0.08] },
		hold: { kind: "body", p: [-0.24, 0.03, 0.06] },
		mouth: { kind: "landmark", name: "mouth" },
		flame: { kind: "prop", prop: "cig", point: "tip", offset: [0, -0.02, 0] },
	},
	props: {
		grip: { hand: "l", origin: ["LeftHandIndex2", "LeftHandMiddle2"], points: { fingers: [0, 0, 0] } },
		cig: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { filter: [0, 0, -0.026], tip: [0, 0, 0.058] } },
		lighter: { hand: "l", origin: ["LeftHand", "LeftHandMiddle1"], points: { body: [0.01, 0, 0], flame: [0.01, 0.036, 0] } },
	},
	fits: [
		{ side: "l", anchor: "handle", effector: { prop: "grip", point: "fingers" } },
		{ side: "r", anchor: "mouth", effector: { prop: "cig", point: "filter" } },
		{ side: "l", anchor: "flame", effector: { prop: "lighter", point: "flame" } },
	],
	generators: [{ type: "walk", f0: 246, steps: 8, step: 0.5, halfWidth: 0.1, lift: 0.08, heading: [125, 150], turnDistance: 0.4, firstStep: 0.4 }],
	checks: {
		contacts: [
			{ name: "fingers on the door handle", point: "prop:grip.fingers", target: "anchor:handle", tol: 0.04, when: "w_handle_l" },
			{ name: "filter on the lips", point: "prop:cig.filter", target: "anchor:mouth", tol: 0.01, when: "w_mouth_r" },
			{ name: "flame under the cigarette tip", point: "prop:lighter.flame", target: "anchor:flame", tol: 0.01, when: "flame_vis" },
		],
		orient: [
			{ name: "lit end points away from the face", from: "prop:cig.filter", to: "prop:cig.tip", along: "face", minCos: 0.64, when: "w_mouth_r" },
			{ name: "lighter upright", from: "prop:lighter.body", to: "prop:lighter.flame", along: "up", minCos: 0.85, when: "flame_vis" },
		],
		below: [{ name: "no chicken-wing elbow", joint: "RightForeArm", ref: "RightArm", min: 0.08, when: "w_mouth_r" }],
		appear: [
			{ name: "cigarette from the right pocket", channel: "cig_vis", joint: "RightHand", anchor: "rpocket", tol: 0.035 },
			{ name: "lighter from the left pocket", channel: "lit_vis", joint: "LeftHand", anchor: "lpocket", tol: 0.035 },
		],
		supports: [{ object: "Car_Seat_Driver", part: "hips", tol: 0.04 }],
		allow: [
			{ part: "torso_lo", object: "Car_Seat_Driver", depth: 0.04 }, { part: "hips", object: "Car_Seat_Driver", depth: 0.04 },
			{ part: "thigh", object: "Car_Seat_Driver", depth: 0.045 }, { part: "torso", object: "Car_Seat_Driver_Back", depth: 0.03 },
			{ part: "hand", object: "Car_Door_L", depth: 0.03 }, { part: "hand", object: "Car_Steering_Wheel", depth: 0.05 },
			{ part: "hand", object: "Car_Door_Handle", depth: 0.04 },
			// the hands rest on the thighs and push on them to stand up (the car skill's THIGH_CONTACT)
			{ part: "hand", object: "thigh*", depth: 0.07 }, { part: "farm", object: "thigh*", depth: 0.07 },
			{ part: "hand", object: "hips", depth: 0.07 }, { part: "farm", object: "hips", depth: 0.07 }, { part: "hand_l", object: "hand_r", depth: 0.035 },
		],
		mouthPoints: ["cig.filter"],
	},
};
