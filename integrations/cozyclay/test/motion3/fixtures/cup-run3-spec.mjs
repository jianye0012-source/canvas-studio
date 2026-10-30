// The spec the agent held in live run3, turn 1 (session c6173b70), before its 6th motion.compile:
// the full spec of compile 3, the repair patches that compile kept, then the base + patch of
// compile 5 (specId spec-440c4b69334b, checked with specIdOf). It compiles on the cup scene
// (cup-scene.mjs) to QA 3 with every goal met: COLLIDE thigh_r/thigh_l x cube 0.9 and 1.4 mm
// past the 5 mm limit, caused by use[1] walkTo. The agent then spent four compiles on them by
// hand (RUN3_MANUAL); the last of its arg edits left POP LeftForeArm accel 5.04 cm/f^2.
export const RUN3_SPEC = {
	schema: "cozyclay.motion-spec.v1",
	fps: 24,
	frames: 200,
	label: "pick up the cup",
	use: [
		{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } },
		{ skill: "walkTo", f0: 10, args: { to: [0, 0.46], steps: 2, step: 0.4, firstStep: 0.4, heading: [0, 0] } },
	],
	anchors: { handle: { kind: "world", p: [0.268, 0.8, 0.85] }, lift: { kind: "world", p: [0.22, 1.22, 0.64] } },
	props: { handleGrip: { hand: "l", origin: ["LeftHandIndex2", "LeftHandMiddle2"], points: { fingers: [0, 0, 0] } } },
	fits: [
		{ side: "l", anchor: "handle", effector: { prop: "handleGrip", point: "fingers" } },
		{ side: "l", anchor: "lift", effector: { prop: "handleGrip", point: "fingers" } },
	],
	objects: { "empty-2": { prop: "handleGrip", grab: 112 } },
	fix: { retime: true },
	checks: {
		allow: [{ part: "hand_l", object: "cube-6", depth: 0.03 }, { part: "hand_l", object: "cube-7", depth: 0.03 }, { part: "hand_l", object: "cube-8", depth: 0.03 }, { part: "hand_l", object: "cylinder", depth: 0.03 }, { part: "farm_l", object: "cylinder", depth: 0.02 }],
	},
	keys: [
		{ f: 86, set: { armw_l: 0, w_handle_l: 1, w_lift_l: 0, fingers_l: { grip: 0 }, elbow_l: [1, -1, -0.3], head_pitch: 0, spine_pitch: 0, pitch: 0 } },
		{ f: 104, set: { fingers_l: { grip: 0.2 } } },
		{ f: 110, set: { armw_l: 1, head_pitch: 20, spine_pitch: 35, pitch: 20 } },
		{ f: 112, set: { fingers_l: { grip: 1 } } },
		{ f: 118, set: { w_handle_l: 1, w_lift_l: 0 } },
		{ f: 156, set: { w_handle_l: 0, w_lift_l: 1, head_pitch: 12, spine_pitch: 2, pitch: 0 } },
	],
	goals: [
		{ name: "left fingers on the cup handle at grab", near: ["prop:handleGrip.fingers", "object:cube-6"], tol: 0.05, at: [110, 114] },
		{ name: "cup lifted off the table", moved: "object:empty-2", by: 0.2, at: [160, 199] },
		{ name: "cup above table top", above: ["object:empty-2", "object:cube"], by: 0.15, at: [160, 199] },
	],
};

/** The agent's own patches after RUN3_SPEC, one compile each (the session's specIds). */
export const RUN3_MANUAL = [
	{ specId: "spec-5bf3d65915f0", patch: [{ op: "add", path: "/use/1/args/lift", value: 0.05 }], base: "spec-440c4b69334b" },
	{ specId: "spec-67fc2f340b24", patch: [{ op: "replace", path: "/use/1/args/step", value: 0.39 }], base: "spec-5bf3d65915f0" },
	{ specId: "spec-2f5debe72b57", patch: [{ op: "replace", path: "/use/1/args/firstStep", value: 0.39 }], base: "spec-5bf3d65915f0" },
];
