// The baseball swing of agent session 294ac65a (2026-10-15): the agent built the bat and the
// plate with arrange_objects and installed `spec-3a5803641a71` (rebuilt in the session as the
// literal below, which compiles to that specId). The bat is a 0.84 m cylinder carried by the
// right hand at a fixed palm offset (at/along), so it keeps one angle to the forearm all swing:
// the defect the held-object keys (spec.objects[id].keys, docs/motion-api-v3.1.md C14) fix.
// Units: metres, +Y up; a record's position is its base pivot; every primitive is 1 m at scale 1.

// [id, name, renderer, x, y, z, scaleX, scaleY, scaleZ]
const RECORDS = [
	["cylinder", "Baseball Bat", "cylinder", -0.4, 0, 0.3, 0.06, 0.84, 0.06],
	["cube", "Home Plate", "cube", 0, 0, 0.75, 0.43, 0.02, 0.43],
];

export const SCENE_OBJECTS = RECORDS.map(([id, name, renderer, x, y, z, scaleX, scaleY, scaleZ]) => ({
	id, name, renderer, x, y, z, rot: 0, rotX: 0, rotZ: 0, scaleX, scaleY, scaleZ, footprint: { width: 1, depth: 1 }, height: 1,
}));

export const CHARACTER = { id: "char-a", model: "y-bot-tpose", subject: "a young woman in a tan coat", x: 0, y: 0, z: 0, rot: 0, scale: 1 };

export const BAT = "cylinder";
export const INSTALLED_SPEC_ID = "spec-3a5803641a71";

const u = [0, 0.5, 0.866], m = k => u.map(c => +(c * k).toFixed(4));

/** The installed spec, as the session rebuilt it (same specId). */
export const SWING_SPEC = { schema: "cozyclay.motion-spec.v1", fps: 24, frames: 96, label: "baseball swing (RHB)",
	props: { batGrip: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { low: m(-0.085), knob: m(-0.14), tip: m(0.7) } },
		lGrip: { hand: "l", origin: ["LeftHandIndex2", "LeftHandMiddle2"], points: { fingers: [0, 0, 0] } } },
	anchors: { lowGrip: { kind: "prop", prop: "batGrip", point: "low" }, stanceTip: { kind: "world", p: [-0.43, 1.89, -0.24] }, contactTip: { kind: "world", p: [0.35, 1.12, 1.08] },
		finishTip: { kind: "world", p: [-0.3, 1.35, -0.45] } },
	fits: [{ side: "l", anchor: "lowGrip", effector: { prop: "lGrip", point: "fingers" } }],
	objects: { cylinder: { prop: "batGrip", at: m(-0.14), along: u } },
	checks: { allow: [{ part: "hand_l", object: "cylinder", depth: 0.04 }, { part: "hand_r", object: "cylinder", depth: 0.04 }] },
	goals: [
		{ name: "bat up over the back shoulder in stance", near: ["prop:batGrip.tip", "anchor:stanceTip"], tol: 0.15, at: [0, 24] },
		{ name: "barrel through the zone at contact", near: ["prop:batGrip.tip", "anchor:contactTip"], tol: 0.2, at: 47 },
		{ name: "bat wraps behind at finish", near: ["prop:batGrip.tip", "anchor:finishTip"], tol: 0.25, at: [62, 72] },
		{ name: "left hand on the bat handle", near: ["prop:lGrip.fingers", "anchor:lowGrip"], tol: 0.05, at: [0, 95] },
		{ name: "bat swings", moved: "object:cylinder.center", by: 0.8, at: [40, 56] }],
	keys: [
		{ f: 0, set: { root: [0, 0.9, -0.04], yaw: -5, pitch: 12, spine_yaw: -10, head_yaw: 80, head_pitch: -5, foot_l: [0.33, 0.117, 0.02], foot_r: [-0.33, 0.1, 0], fyaw_l: 10, fyaw_r: -5,
			knee_l: [0.3, 0, 1], knee_r: [-0.3, 0, 1], armw_r: 1, armw_l: 1, w_lowGrip_l: 1, hand_r: [-0.24, 1.36, 0.12], elbow_r: [-1, -0.6, 0], elbow_l: [0, -1, 0.5],
			fingers_r: { grip: 1 }, fingers_l: { grip: 1 }, wtwist_r: 20, wflex_r: 0 } },
		{ f: 24, set: { root: [0, 0.9, -0.04], yaw: -5, spine_yaw: -10, hand_r: [-0.24, 1.36, 0.12], wtwist_r: 20 } },
		{ f: 34, set: { root: [-0.08, 0.88, -0.03], yaw: -15, spine_yaw: -20, hand_r: [-0.3, 1.38, 0.04], foot_l: [0.3, 0.17, 0.02], fpitch_l: 20 } },
		{ f: 40, set: { root: [0.06, 0.86, -0.03], yaw: -10, spine_yaw: -20, foot_l: [0.5, 0.1, 0.04], fpitch_l: 0, hand_r: [-0.3, 1.34, 0.05], wtwist_r: 25 } },
		{ f: 44, set: { root: [0.1, 0.85, -0.02], yaw: 25, spine_yaw: 0, hand_r: [-0.12, 1.15, 0.25], elbow_r: [-0.8, -1, -0.2], fpitch_r: 15 } },
		{ f: 47, set: { root: [0.12, 0.85, 0], yaw: 50, spine_yaw: 15, head_yaw: 40, hand_r: [0.27, 1.1, 0.37], elbow_r: [-0.6, -1, -0.2], fyaw_r: 30, fpitch_r: 30, foot_r: [-0.33, 0.137, 0], wtwist_r: 60,
			knee_l: [-0.5, 0, 0.85] } },
		{ f: 53, set: { root: [0.14, 0.86, 0], yaw: 70, spine_yaw: 25, head_yaw: 25, hand_r: [0.42, 1.25, 0.15], elbow_r: [0, -1, 0.3], fyaw_r: 55, fpitch_r: 45, foot_r: [-0.3, 0.14, 0.01],
			knee_r: [-0.1, 0, 1], knee_l: [-0.6, 0, 0.8] } },
		{ f: 62, set: { root: [0.15, 0.88, 0], yaw: 80, pitch: 6, spine_yaw: 35, head_yaw: 10, hand_r: [0.42, 1.48, -0.17], elbow_r: [-0.3, -0.6, 1], elbow_l: [0, -1, 0], fyaw_r: 70, fpitch_r: 55,
			foot_r: [-0.24, 0.16, 0.04], knee_l: [-0.7, 0, 0.7], fyaw_l: 35, wtwist_r: -85 } },
		{ f: 74, set: { root: [0.15, 0.9, 0], yaw: 80, spine_yaw: 35, hand_r: [0.41, 1.48, -0.19] } },
		{ f: 57, set: { hand_r: [0.46, 1.38, 0.0], elbow_l: [0.3, -1, 0.2] } }] };

/**
 * Bat keys a user would set by dragging the bat (C14): at f40 the tip up over the back shoulder
 * (stanceTip), f44 lagging behind the hands, f47 through the zone (contactTip), f53 extended past
 * the plate. Each keeps the grip where the hands were and turns the bat about it (made from the
 * plain take: the bat axis swung the short way onto grip -> tip target).
 */
export const SWING_KEYS = [
	{ f: 40, pos: [-0.2279, 1.3409, 0.2428], rot: [-0.16499, -0.60817, 0.33294, 0.70147] },
	{ f: 44, pos: [0.0309, 1.158, 0.2297], rot: [0.59034, -0.17122, 0.11337, 0.7806] },
	{ f: 47, pos: [0.4179, 1.1666, 0.2482], rot: [0.71849, 0.04645, 0.10797, 0.68553] },
	{ f: 53, pos: [0.4508, 1.2866, -0.0208], rot: [0.45262, 0.45159, 0.08859, 0.76378] }];
