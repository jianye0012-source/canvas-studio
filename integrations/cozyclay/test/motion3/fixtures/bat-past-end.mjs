// Bat-swing specs the Studio agent sent on 2026-10-15 ("야구 배트를 휘두르는 모습을 만들어줘") that were
// refused, copied verbatim from the session logs (lane M2). Each runs on char-a (Y Bot at the origin,
// yaw 0) with the bat kit (fixtures/bat-aim-swing.mjs batKit) at kitAt.
//   REACH_PAST_END  reachGrip keeps the left hand on the bat all take, and reach + hold + release
//                   ran one frame past the last: `use[0] reachGrip needs 84 frames from f0 (to f84),
//                   past the last frame f83; ...`. The agent recompiled with one more frame each time.
//   MOVED_POINT     goals[i].moved "prop:batGrip.tip" was refused: `must be object:<id>[.center|.top|.base]`.
//                   The f7d790ac spec also has a position probe with every 4 over 72 frames (18 rows, cap 16).
// Units: metres, +Y up.

export const REACH_PAST_END = [
	// session f7d790ac, line 18
	{ session: "f7d790ac", kitAt: [0.35, 0, 0.3], spec: {
		schema: "cozyclay.motion-spec.v1",
		fps: 24,
		frames: 84,
		label: "baseball swing",
		props: { batGrip: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { low: [0, -0.0425, -0.0736], knob: [0, -0.07, -0.1212], tip: [0, 0.35, 0.6062] } } },
		objects: { empty: { prop: "batGrip", at: [0, -0.07, -0.1212], along: [0, 0.5, 0.866], grab: 0, keys: [{ f: 0, pos: [-0.16, 1.15, 0.2], aim: [-0.3, 0.85, -0.35] }, { f: 20, pos: [-0.22, 1.22, 0.14], aim: [-0.3, 0.7, -0.6] }, { f: 31, pos: [-0.14, 1.1, 0.22], aim: [-0.65, 0.3, -0.7] }, { f: 37, pos: [0.02, 1, 0.38], aim: [0.2, 0, 1] }, { f: 43, pos: [0.25, 1.08, 0.32], aim: [0.95, 0.2, 0.15] }, { f: 54, pos: [0.3, 1.32, 0.2], aim: [0.4, 0.45, -0.8] }, { f: 83, pos: [0.3, 1.3, 0.2], aim: [0.4, 0.5, -0.77] }] } },
		use: [{ skill: "reachGrip", f0: 0, args: { anchor: "batLow", side: "l", reach: 4, hold: 72, release: 8, elbow: [0.4, -1, 0], define: { kind: "prop", prop: "batGrip", point: "low" } } }],
		keys: [{ f: 0, set: { root: [0.03, 0.9, -0.03], foot_l: [0.3, 0.105, 0.02], foot_r: [-0.3, 0.105, 0], fyaw_l: 15, fyaw_r: 0, spine_yaw: -10, head_yaw: 60, pitch: 6, armw_r: 1, elbow_r: [-1, -0.6, -0.3], knee_l: [0.2, 0, 1], knee_r: [-0.2, 0, 1], fingers_r: { grip: 1 } } }, { f: 8, set: { elbow_r: [-1, -0.6, -0.3] } }, { f: 20, set: { root: [-0.03, 0.88, -0.03], foot_l: [0.26, 0.16, 0.02], spine_yaw: -22, head_yaw: 68, pitch: 8, elbow_r: [-1, -0.6, -0.3] } }, { f: 30, set: { root: [0.03, 0.86, -0.03], foot_l: [0.4, 0.105, 0.05], fyaw_l: 25, spine_yaw: -15, head_yaw: 55 } }, { f: 37, set: { root: [0.08, 0.86, -0.03], spine_yaw: 10, head_yaw: 30, pitch: 10, fyaw_r: 25, fpitch_r: 15 } }, { f: 46, set: { root: [0.1, 0.88, -0.03], spine_yaw: 45, head_yaw: 10, pitch: 7, fyaw_r: 50, fpitch_r: 35 } }, { f: 56, set: { root: [0.1, 0.9, -0.03], spine_yaw: 60, head_yaw: 0, pitch: 4, fyaw_r: 60, fpitch_r: 40 } }, { f: 82, set: { elbow_l: [0.4, -1, 0] } }, { f: 83, set: { root: [0.1, 0.9, -0.03], spine_yaw: 58, head_yaw: 0, pitch: 3, elbow_l: [0.4, -1, 0] } }],
		goals: [{ name: "left hand stays on bat", near: ["joint:LeftHand", "prop:batGrip.low"], tol: 0.1, at: [6, 74] }, { name: "bat sweeps through the swing", moved: "object:empty.center", by: 0.4, at: [20, 46] }],
		probes: [{ name: "tip path", position: "prop:batGrip.tip", frames: [0, 83], every: 6 }],
	} },
	// session d5c110a7, line 9
	{ session: "d5c110a7", kitAt: [0, 0, 0], spec: {
		schema: "cozyclay.motion-spec.v1",
		fps: 24,
		frames: 64,
		label: "baseball bat swing",
		props: { batGrip: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { low: [0, -0.0425, -0.0736], knob: [0, -0.07, -0.1212], tip: [0, 0.35, 0.6062] } } },
		use: [{ skill: "reachGrip", f0: 0, args: { anchor: "batLow", side: "l", reach: 4, hold: 58, release: 2, define: { kind: "prop", prop: "batGrip", point: "low" } } }],
		objects: { empty: { prop: "batGrip", at: [0, -0.07, -0.1212], along: [0, 0.5, 0.866], grab: 0, keys: [{ f: 0, pos: [-0.18, 1.3, 0.15], aim: [-0.25, 0.85, -0.45] }, { f: 14, pos: [-0.2, 1.32, 0.13], aim: [-0.2, 0.85, -0.5] }, { f: 22, pos: [-0.28, 1.36, 0.05], aim: [-0.1, 0.6, -0.8] }, { f: 27, pos: [-0.1, 1.15, 0.35], aim: [-0.9, 0.15, -0.3] }, { f: 30, pos: [0.05, 1, 0.45], aim: [0.15, -0.05, 1] }, { f: 33, pos: [0.25, 1.08, 0.35], aim: [0.9, 0.1, 0.25] }, { f: 39, pos: [0.25, 1.35, 0.05], aim: [0.2, 0.5, -0.85] }, { f: 63, pos: [0.25, 1.35, 0.05], aim: [0.2, 0.5, -0.85] }] } },
		keys: [{ f: 0, set: { root: [0, 0.92, 0], yaw: -10, pitch: 15, spine_yaw: -5, head_yaw: 60, head_pitch: -5, foot_l: [0.3, 0.105, 0], foot_r: [-0.3, 0.105, 0], fyaw_l: 10, fyaw_r: -5, knee_l: [0.3, 0, 1], knee_r: [-0.3, 0, 1], elbow_r: [-1, -0.5, 0], elbow_l: [0.5, -1, 0.3] } }, { f: 14, set: { root: [-0.02, 0.92, 0], foot_l: [0.3, 0.105, 0] } }, { f: 20, set: { root: [-0.06, 0.93, 0], yaw: -18, spine_yaw: -10, foot_l: [0.38, 0.17, 0] } }, { f: 25, set: { root: [0.04, 0.89, 0], yaw: 0, foot_l: [0.46, 0.105, 0.02] } }, { f: 30, set: { root: [0.1, 0.88, 0], yaw: 40, spine_yaw: 15, head_yaw: 20, fpitch_r: 0, fyaw_r: -5 } }, { f: 34, set: { fpitch_r: 45, fyaw_r: 35 } }, { f: 39, set: { root: [0.13, 0.9, 0], yaw: 70, spine_yaw: 25, head_yaw: -20, fpitch_r: 50 } }, { f: 63, set: { root: [0.13, 0.9, 0], yaw: 70, spine_yaw: 25 } }],
		goals: [{ name: "bat moves through the swing", moved: "object:empty", by: 0.4, at: [22, 39] }, { name: "bat tip out over the plate at contact", near: ["prop:batGrip.tip", "anchor:contact"], tol: 0.3, at: [29, 31], mode: "any" }],
		anchors: { contact: { kind: "world", p: [0.18, 0.96, 1.28] } },
	} },
	// session 9dcf19c5, line 8
	{ session: "9dcf19c5", kitAt: [-0.3, 0.9, 0.3], spec: {
		schema: "cozyclay.motion-spec.v1",
		fps: 24,
		frames: 76,
		label: "baseball bat swing (right-handed)",
		channels: ["trail"],
		props: { batGrip: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { low: [0, -0.0425, -0.0736], knob: [0, -0.07, -0.1212], tip: [0, 0.35, 0.6062] } } },
		anchors: { hitZone: { kind: "world", p: [0.3, 0.95, 1] } },
		objects: { empty: { prop: "batGrip", at: [0, -0.07, -0.1212], along: [0, 0.5, 0.866], grab: 0, keys: [{ f: 0, pos: [-0.2, 1.38, -0.05], aim: [-0.25, 0.85, -0.45] }, { f: 12, pos: [-0.18, 1.36, -0.04], aim: [-0.1, 0.9, -0.4] }, { f: 24, pos: [-0.2, 1.38, -0.05], aim: [-0.25, 0.85, -0.45] }, { f: 32, pos: [-0.3, 1.42, -0.1], aim: [0.15, 0.8, -0.55] }, { f: 38, pos: [-0.15, 1.15, 0.15], aim: [-0.6, 0.3, -0.6] }, { f: 42, pos: [0.1, 1, 0.35], aim: [0.3, -0.05, 0.95] }, { f: 46, pos: [0.35, 1.05, 0.2], aim: [0.95, 0.05, 0.2] }, { f: 52, pos: [0.2, 1.4, -0.15], aim: [-0.7, 0.2, -0.6] }, { f: 75, pos: [0.18, 1.38, -0.15], aim: [-0.7, 0.25, -0.6] }] }, effect: { level: "trail" } },
		keys: [{ f: 0, set: { root: [0, 0.93, 0], yaw: -5, pitch: 15, spine_yaw: 0, head_yaw: 70, head_pitch: 5, foot_l: [0.33, 0.087, 0.02], foot_r: [-0.33, 0.087, 0], fyaw_l: 5, fyaw_r: 0, fpitch_r: 0, fingers_r: { grip: 1 }, trail: 0 } }, { f: 24, set: { root: [0, 0.93, 0], yaw: -5, head_yaw: 70, foot_l: [0.33, 0.087, 0.02], trail: 0 } }, { f: 30, set: { root: [-0.04, 0.92, 0], yaw: -15, spine_yaw: -10, head_yaw: 90, foot_l: [0.42, 0.17, 0.02], trail: 0 } }, { f: 34, set: { trail: 0 } }, { f: 36, set: { root: [0.05, 0.9, 0], yaw: 0, spine_yaw: -5, head_yaw: 75, foot_l: [0.55, 0.087, 0.03], fyaw_l: 30, fyaw_r: 10, fpitch_r: 10, trail: 1 } }, { f: 42, set: { root: [0.12, 0.9, 0.02], yaw: 50, spine_yaw: 15, pitch: 18, head_yaw: -40, head_pitch: 25, fyaw_r: 50, fpitch_r: 35, trail: 1 } }, { f: 50, set: { trail: 1 } }, { f: 52, set: { root: [0.18, 0.92, 0.02], yaw: 80, spine_yaw: 25, pitch: 10, head_yaw: -20, head_pitch: 10, fyaw_r: 80, fpitch_r: 50 } }, { f: 58, set: { trail: 0 } }, { f: 75, set: { root: [0.18, 0.93, 0.02], yaw: 82, spine_yaw: 25, pitch: 8, head_yaw: -15, head_pitch: 5, fyaw_r: 82, fpitch_r: 50, trail: 0 } }],
		use: [{ skill: "reachGrip", f0: 0, args: { anchor: "batLow", side: "l", reach: 4, hold: 66, release: 6, define: { kind: "prop", prop: "batGrip", point: "low" } } }],
		goals: [{ name: "bat barrel meets the hitting zone at contact", near: ["prop:batGrip.tip", "anchor:hitZone"], tol: 0.15, at: 42 }, { name: "left hand stays on the bat through the swing", near: ["joint:LeftHand", "prop:batGrip.low"], tol: 0.1, at: [6, 60] }, { name: "follow-through finishes high", above: ["prop:batGrip.origin", "joint:Hips"], at: 56 }],
	} },
];

export const MOVED_POINT = [
	// session df6acdcc, line 11
	{ session: "df6acdcc", kitAt: [0.3, 0, 0.3], spec: {
		schema: "cozyclay.motion-spec.v1",
		fps: 24,
		frames: 90,
		label: "baseball swing",
		props: { batGrip: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { low: [0, -0.0425, -0.0736], knob: [0, -0.07, -0.1212], tip: [0, 0.35, 0.6062] } } },
		objects: { empty: { prop: "batGrip", at: [0, -0.07, -0.1212], along: [0, 0.5, 0.866], grab: 0, keys: [{ f: 0, pos: [-0.22, 1.28, 0.22], aim: [-0.3, 0.9, -0.3] }, { f: 24, pos: [-0.22, 1.3, 0.2], aim: [-0.2, 0.9, -0.4] }, { f: 31, pos: [-0.3, 1.35, 0.12], aim: [0.35, 0.7, -0.6] }, { f: 36, pos: [-0.12, 1.12, 0.35], aim: [-0.6, 0.25, -0.75] }, { f: 39, pos: [0.05, 1, 0.45], aim: [0.1, -0.1, 1] }, { f: 42, pos: [0.3, 1.05, 0.38], aim: [1, 0.05, 0.3] }, { f: 48, pos: [0.25, 1.35, -0.02], aim: [-0.3, 0.35, -1] }, { f: 89, pos: [0.22, 1.33, -0.02], aim: [-0.3, 0.4, -1] }] }, effect: { visible: "trail_vis" } },
		anchors: { lgrip: { kind: "prop", prop: "batGrip", point: "low" } },
		use: [{ skill: "reachGrip", f0: 0, args: { anchor: "lgrip", side: "l", reach: 4, hold: 76, release: 4 } }],
		keys: [{ f: 0, set: { root: [0, 0.9, 0], foot_l: [0.36, 0.105, 0], foot_r: [-0.36, 0.105, 0], yaw: 0, spine_yaw: -10, spine_pitch: 15, head_yaw: 60, fyaw_l: 20, fyaw_r: 0, fpitch_r: 0, trail_vis: 0 } }, { f: 24, set: { root: [-0.03, 0.9, 0], foot_l: [0.36, 0.105, 0], spine_yaw: -15, head_yaw: 65 } }, { f: 30, set: { root: [-0.08, 0.91, 0], foot_l: [0.3, 0.22, 0.02], spine_yaw: -30, yaw: -12, head_yaw: 75 } }, { f: 34, set: { root: [0.05, 0.88, 0], foot_l: [0.55, 0.105, 0], spine_yaw: -25, yaw: 0, trail_vis: 1 }, step: ["trail_vis"] }, { f: 39, set: { root: [0.1, 0.87, 0], spine_yaw: 5, yaw: 35, head_yaw: 40, fpitch_r: 25, fyaw_r: 30 } }, { f: 44, set: { root: [0.13, 0.88, 0], spine_yaw: 30, yaw: 60, head_yaw: 20, fpitch_r: 45, fyaw_r: 60 } }, { f: 52, set: { root: [0.14, 0.9, 0], spine_yaw: 30, yaw: 75, head_yaw: 0, spine_pitch: 8, fpitch_r: 50, fyaw_r: 75, trail_vis: 0 }, step: ["trail_vis"] }, { f: 89, set: { root: [0.14, 0.92, 0], spine_yaw: 28, yaw: 75, head_yaw: 0, spine_pitch: 5, fpitch_r: 50, fyaw_r: 75 } }],
		goals: [{ name: "bat swings through", moved: "prop:batGrip.tip", by: 1.2, at: [31, 48] }, { name: "left hand on bat", near: ["joint:LeftHand", "prop:batGrip.low"], tol: 0.1, at: [6, 78] }],
	} },
	// session f7d790ac, line 10
	{ session: "f7d790ac", kitAt: [0.35, 0, 0.3], spec: {
		schema: "cozyclay.motion-spec.v1",
		fps: 24,
		frames: 72,
		label: "baseball swing",
		props: { batGrip: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { low: [0, -0.0425, -0.0736], knob: [0, -0.07, -0.1212], tip: [0, 0.35, 0.6062] } } },
		objects: { empty: { prop: "batGrip", at: [0, -0.07, -0.1212], along: [0, 0.5, 0.866], grab: 0, keys: [{ f: 0, pos: [-0.12, 1.12, 0.08], aim: [-0.35, 0.85, -0.4] }, { f: 20, pos: [-0.22, 1.25, -0.04], aim: [-0.25, 0.6, -0.75] }, { f: 31, pos: [-0.12, 1.1, 0.12], aim: [-0.65, 0.3, -0.7] }, { f: 37, pos: [0.02, 1, 0.36], aim: [0.2, 0, 1] }, { f: 43, pos: [0.25, 1.08, 0.28], aim: [0.95, 0.2, 0.15] }, { f: 54, pos: [0.2, 1.38, -0.04], aim: [0.25, 0.35, -0.9] }, { f: 71, pos: [0.2, 1.36, -0.04], aim: [0.25, 0.4, -0.88] }] } },
		use: [{ skill: "reachGrip", f0: 0, args: { anchor: "batLow", side: "l", reach: 4, hold: 63, release: 4, elbow: [0.4, -1, 0], define: { kind: "prop", prop: "batGrip", point: "low" } } }],
		keys: [{ f: 0, set: { root: [0, 0.9, 0], foot_l: [0.3, 0.105, 0.02], foot_r: [-0.3, 0.105, 0], fyaw_l: 15, fyaw_r: 0, spine_yaw: -10, head_yaw: 60, pitch: 10, armw_r: 1, elbow_r: [-0.5, -1, 0], knee_l: [0.2, 0, 1], knee_r: [-0.2, 0, 1], fingers_r: { grip: 1 } } }, { f: 20, set: { root: [-0.06, 0.88, 0], foot_l: [0.26, 0.16, 0.02], spine_yaw: -28, head_yaw: 70, pitch: 12 } }, { f: 30, set: { root: [0, 0.86, 0], foot_l: [0.4, 0.105, 0.05], fyaw_l: 25, spine_yaw: -15, head_yaw: 55 } }, { f: 37, set: { root: [0.05, 0.86, 0], spine_yaw: 10, head_yaw: 30, pitch: 14, fyaw_r: 25, fpitch_r: 15 } }, { f: 46, set: { root: [0.07, 0.88, 0], spine_yaw: 45, head_yaw: 10, pitch: 10, fyaw_r: 50, fpitch_r: 35 } }, { f: 56, set: { root: [0.07, 0.9, 0], spine_yaw: 60, head_yaw: 0, pitch: 6, fyaw_r: 60, fpitch_r: 40 } }, { f: 71, set: { root: [0.07, 0.9, 0], spine_yaw: 58, head_yaw: 0, pitch: 5 } }],
		goals: [{ name: "left hand stays on bat", near: ["joint:LeftHand", "prop:batGrip.low"], tol: 0.1, at: [6, 66] }, { name: "bat tip sweeps through the swing", moved: "prop:batGrip.tip", by: 1, at: [20, 46] }],
		probes: [{ name: "tip path", position: "prop:batGrip.tip", frames: [0, 71], every: 4 }],
	} },
];

