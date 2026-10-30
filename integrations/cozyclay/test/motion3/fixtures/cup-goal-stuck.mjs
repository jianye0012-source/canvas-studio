// The two live round-2 sessions (2026-10-15) where turn 1 stuck on the goal "fingers on cup
// handle at grab" (cup-scene.mjs, a Y Bot). Each is the spec the agent sent with repair at its
// first stuck compile, rebuilt from the session: the full spec, the patches that compile's repair
// kept, then the agent's base + patch (specIds checked with specIdOf).
//   f275fda4: compile 8 sent F275_FULL; its repair kept F275_REPAIR8 (stored spec-e3d720274680);
//             compile 9 sent base spec-e3d720274680 + F275_PATCH9 with repair { rounds: 3 } and
//             stored spec-34a2b58fe6b9 (the goal 8.2 cm off, needs <= 5 cm). Eight more compiles
//             followed before the goal held.
//   c8f2018b: compile 7 sent C8F2_FULL with repair { rounds: 3 } and stored spec-f0d208a2cb6d
//             (frames "auto" resolved; the goal 9 cm off, needs <= 4 cm). Five more compiles and
//             four refused calls followed.
// Both miss for the same reason: an anchor weight of the left hand that is keyed 0 before the
// reach and 1 well after the grab (w_raise_l, w_lift_l) ramps through the grab frame, so the hand
// target is part handle, part that anchor. The arm is not at full reach there.

export const F275_FULL = {
	schema: "cozyclay.motion-spec.v1",
	fps: 24,
	frames: 180,
	label: "Pick up the cup",
	use: [
		{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } },
		{ skill: "walkTo", f0: 1, args: { to: [0.08, 0.4], steps: 2, step: 0.2, firstStep: 0.25, heading: 0 } },
	],
	anchors: { approach: { kind: "world", p: [0.27, 0.98, 0.78] }, handle: { kind: "world", p: [0.268, 0.8, 0.85] }, lift: { kind: "world", p: [0.213, 1.121, 0.57] } },
	props: { cupGrip: { hand: "l", origin: ["LeftHandIndex2", "LeftHandMiddle2"], points: { fingers: [0, 0, 0] } } },
	fits: [
		{ side: "l", anchor: "handle", effector: { prop: "cupGrip", point: "fingers" } },
		{ side: "l", anchor: "lift", effector: { prop: "cupGrip", point: "fingers" }, offset: [-0.0632, 0.074, 0.0668] },
		{ side: "l", anchor: "approach", effector: { prop: "cupGrip", point: "fingers" } },
	],
	objects: { "empty-2": { prop: "cupGrip", grab: 114 } },
	fix: { penetration: 0.02, retime: true },
	keys: [
		{ f: 78, set: { armw_l: 0, hand_l: [0.3, 0.92, 0.45], w_handle_l: 0, w_lift_l: 0, w_approach_l: 0, fingers_l: { grip: 0 }, spine_pitch: 0, pitch: 0, head_pitch: 0 } },
		{ f: 96, set: { armw_l: 1, w_approach_l: 1, fingers_l: { grip: 0.15 }, spine_pitch: 18, pitch: 12, head_pitch: 15 } },
		{ f: 108, set: { w_approach_l: 0, w_handle_l: 1, fingers_l: { grip: 0.3 }, spine_pitch: 30, pitch: 28, head_pitch: 15, spine_yaw: 10 } },
		{ f: 114, set: { fingers_l: { grip: 1 } } },
		{ f: 122, set: { w_handle_l: 1, w_lift_l: 0, spine_pitch: 30, pitch: 28 } },
		{ f: 154, set: { w_handle_l: 0, w_lift_l: 1, spine_pitch: 5, pitch: 0, head_pitch: 12, spine_yaw: 0 } },
	],
	goals: [
		{ name: "fingers on cup handle at grab", near: ["prop:cupGrip.fingers", "anchor:handle"], tol: 0.05, at: 114 },
		{ name: "cup lifted off the table", moved: "object:empty-2.base", by: 0.25, at: [165, 179] },
	],
};

export const F275_REPAIR8 = [
	{ op: "replace", path: "/anchors/approach/p", value: [0.255, 1.0743, 0.7192] },
	{ op: "add", path: "/fits/0/offset", value: [0, 0.0044, 0] },
	{ op: "replace", path: "/fits/0/offset", value: [0, 0.0098, 0] },
	{ op: "replace", path: "/fits/0/offset", value: [0, 0.017, 0] },
];

export const F275_PATCH9 = [
	{ op: "replace", path: "/anchors/lift/p", value: [0.206, 1.166, 0.542] },
	{ op: "add", path: "/anchors/raise", value: { kind: "world", p: [0.265, 0.95, 0.82] } },
	{ op: "add", path: "/fits/-", value: { side: "l", anchor: "raise", effector: { prop: "cupGrip", point: "fingers" } } },
	{ op: "add", path: "/keys/0/set/w_raise_l", value: 0 },
	{ op: "replace", path: "/keys/5", value: { f: 138, set: { w_handle_l: 0, w_raise_l: 1, w_lift_l: 0, spine_pitch: 24, pitch: 20, head_pitch: 14, spine_yaw: 6 } } },
	{ op: "add", path: "/keys/-", value: { f: 164, set: { w_raise_l: 0, w_lift_l: 1, spine_pitch: 5, pitch: 0, head_pitch: 12, spine_yaw: 0 } } },
	{ op: "replace", path: "/goals/1/at", value: [170, 179] },
];

/** What compile 9's repair kept (the session's stored spec-34a2b58fe6b9). */
export const F275_REPAIR9 = [{ op: "replace", path: "/anchors/handle/p", value: [0.2685, 0.7744, 0.8529] }];

export const C8F2_FULL = {
	schema: "cozyclay.motion-spec.v1",
	frames: "auto",
	label: "Pick up cup",
	fix: { penetration: 0.02 },
	anchors: { approach: { kind: "world", p: [0.29, 0.97, 0.74] }, handle: { kind: "world", p: [0.268, 0.8, 0.85] }, rise: { kind: "world", p: [0.268, 0.96, 0.8] }, lift: { kind: "world", p: [0.3, 1.11, 0.64] } },
	props: { cupGrip: { hand: "l", origin: ["LeftHandIndex2", "LeftHandMiddle2"], points: { fingers: [0, 0, 0] } } },
	fits: [
		{ side: "l", anchor: "approach", effector: { prop: "cupGrip", point: "fingers" } },
		{ side: "l", anchor: "handle", effector: { prop: "cupGrip", point: "fingers" } },
		{ side: "l", anchor: "rise", effector: { prop: "cupGrip", point: "fingers" } },
		{ side: "l", anchor: "lift", effector: { prop: "cupGrip", point: "fingers" } },
	],
	objects: { "empty-2": { prop: "cupGrip", grab: 106 } },
	use: [
		{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } },
		{ skill: "walkTo", f0: 1, args: { to: [0, 0.46], steps: 2, heading: 0, firstStep: 0.39 } },
	],
	keys: [
		{ f: 78, set: { armw_l: 0, w_approach_l: 0, w_handle_l: 0, w_rise_l: 0, w_lift_l: 0, fingers_l: { grip: 0 }, spine_pitch: 0, pitch: 0, head_pitch: 0, root: [0, 0.979, 0.46], elbow_l: [0.6, -1, -0.3] } },
		{ f: 90, set: { armw_l: 1, w_approach_l: 1, spine_pitch: 25, pitch: 8, head_pitch: 20, root: [0, 0.95, 0.46] } },
		{ f: 102, set: { w_approach_l: 0, w_handle_l: 1, spine_pitch: 40, pitch: 15, head_pitch: 25, root: [0, 0.92, 0.46], fingers_l: { grip: 0.3 } } },
		{ f: 106, set: { fingers_l: { grip: 1 } } },
		{ f: 112, set: { w_handle_l: 1, w_rise_l: 0, spine_pitch: 40, pitch: 15, root: [0, 0.92, 0.46] } },
		{ f: 124, set: { w_handle_l: 0, w_rise_l: 1, spine_pitch: 28, pitch: 9, root: [0, 0.95, 0.46] } },
		{ f: 146, set: { w_rise_l: 0, w_lift_l: 1, spine_pitch: 4, pitch: 0, head_pitch: 15, root: [0, 0.979, 0.46] } },
		{ f: 176, set: { w_lift_l: 1, fingers_l: { grip: 1 } } },
	],
	goals: [
		{ name: "fingers on cup handle at grab", near: ["prop:cupGrip.fingers", "anchor:handle"], tol: 0.04, at: 106 },
		{ name: "cup lifted off the table", moved: "object:empty-2.base", by: 0.2, at: 176 },
		{ name: "cup held at chest", near: ["prop:cupGrip.fingers", "anchor:lift"], tol: 0.06, at: [150, 176] },
	],
};
