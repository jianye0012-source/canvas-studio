// Scenes and specs of the grasp-socket test (lane socket). Records: [id, name, renderer, parent, x, y, z, scaleX,
// scaleY, scaleZ, rotZ, rot]; units metres, +Y up, a record's position its base pivot, every primitive 1 m at scale 1.
const rec = ([id, name, renderer, parent, x, y, z, scaleX, scaleY, scaleZ, rotZ = 0, rot = 0]) => ({ id, name, renderer, ...(parent ? { parent } : {}),
	x, y, z, rot, rotX: 0, rotZ, scaleX, scaleY, scaleZ, footprint: { width: 1, depth: 1 }, height: 1 });

// Session 02263581's barbell (its arrange_objects calls): a group `empty` with a 1.56 m bar along X, sleeves, plates, collars.
export const BARBELL = [
	["empty", "Barbell", "empty", null, 0, 0, 0.25, 1, 1, 1], ["cylinder", "Bar", "cylinder", "empty", 0.78, 0.225, 0.25, 0.03, 1.56, 0.03, 90],
	["cylinder-2", "Sleeve R", "cylinder", "empty", 0.8, 0.225, 0.25, 0.05, 0.25, 0.05, 90], ["cylinder-3", "Sleeve L", "cylinder", "empty", -0.55, 0.225, 0.25, 0.05, 0.25, 0.05, 90],
	["cylinder-4", "Plate R", "cylinder", "empty", 0.625, 0.225, 0.25, 0.45, 0.05, 0.45, 90], ["cylinder-5", "Plate L", "cylinder", "empty", -0.575, 0.225, 0.25, 0.45, 0.05, 0.45, 90],
	["cylinder-6", "Collar R", "cylinder", "empty", 0.57, 0.225, 0.25, 0.07, 0.03, 0.07, 90], ["cylinder-7", "Collar L", "cylinder", "empty", -0.54, 0.225, 0.25, 0.07, 0.03, 0.07, 90],
].map(rec);

// The session's first lift: both hands reach the bar with reachGrip on object points of the group, the right hand
// carries it on keys from the floor overhead and back. The anchors get `grasp` in the test.
export const barbellSpec = grasp => ({
	schema: "cozyclay.motion-spec.v1", fps: 24, frames: 260, label: "barbell: floor to overhead and back down",
	anchors: { gripL: { kind: "object", object: "empty", local: [0.25, 0.225, 0], ...(grasp ? { grasp } : {}) },
		gripR: { kind: "object", object: "empty", local: [-0.25, 0.225, 0], ...(grasp ? { grasp } : {}) }, rest: { kind: "world", p: [0, 0, 0.25] } },
	keys: [{ f: 0, set: { root: [0, 0.99, 0], yaw: 0, pitch: 0, spine_pitch: 0, head_pitch: 0, foot_l: [0.15, 0.105, 0], foot_r: [-0.15, 0.105, 0], fyaw_l: 8, fyaw_r: -8, knee_l: [0.3, 0, 1], knee_r: [-0.3, 0, 1] } },
		...[[30, 0.64, -0.14, 42, 8, -25], [40, 0.64, -0.14, 42, 8, -25], [70, 0.97, -0.02, 4, 0, -5], [90, 0.95, 0, 0, -4, 0], [110, 0.99, 0, -3, -4, 0], [140, 0.99, 0, -3, -4, 0],
			[160, 0.95, 0, 0, -4, 0], [180, 0.97, -0.02, 4, 0, -5], [215, 0.64, -0.14, 42, 8, -25], [228, 0.64, -0.14, 42, 8, -25], [255, 0.99, 0, 0, 0, 0]]
			.map(([f, y, z, pitch, spine, head]) => ({ f, set: { root: [0, y, z], pitch, spine_pitch: spine, head_pitch: head } }))],
	use: [{ skill: "reachGrip", f0: 10, args: { anchor: "gripL", side: "l", reach: 20, hold: 185, release: 12 } },
		{ skill: "reachGrip", f0: 10, args: { anchor: "gripR", side: "r", reach: 20, hold: 185, release: 12 } }],
	objects: { empty: { prop: "gripRGrip", grab: 30, release: 215, keys: [[30, 0, 0.25], [40, 0, 0.25], [70, 0.575, 0.17], [90, 1.195, 0.14], [110, 1.725, 0.02], [140, 1.725, 0.02],
		[160, 1.195, 0.14], [180, 0.575, 0.17], [215, 0, 0.25]].map(([f, y, z]) => ({ f, pos: [0, y, z] })) } },
});

// A rifle like session 38322b5d's, on a stand ahead at chest height, muzzle +Z (its +X turned by rot -90): stock,
// receiver, handguard, barrel, a magazine and a pistol grip, both tilted like the session's.
const Z0 = 0.3, Y0 = 1.05, at = (u, y) => [0.12, Y0 + y, Z0 + u];
const part = (id, name, renderer, u, y, sx, sy, sz, rotZ = 0) => [id, name, renderer, "rifle", ...at(u, y), sx, sy, sz, rotZ, -90];
export const RIFLE = [["rifle", "Rifle", "empty", null, ...at(0, 0), 1, 1, 1, 0, -90],
	part("stock", "Stock", "cube", -0.21, 0, 0.28, 0.12, 0.045), part("receiver", "Receiver", "cube", 0.08, 0.05, 0.3, 0.09, 0.05),
	part("handguard", "Handguard", "cube", 0.363, 0.06, 0.26, 0.065, 0.055), part("barrel", "Barrel", "cylinder", 0.45, 0.095, 0.022, 0.2, 0.022, -90),
	part("mag", "Magazine", "cube", 0.15, -0.1, 0.06, 0.16, 0.035, 10), part("pgrip", "Pistol grip", "cube", -0.02, -0.06, 0.04, 0.12, 0.035, -18),
	["stand", "Stand", "cube", null, 0.12, 0, Z0, 0.3, Y0 - 0.12, 0.6]].map(rec);

/** The rifle spec: the right hand takes the pistol grip, the left the magazine, then a walk; keys carry the rifle along `path(f)`. */
// The stand reaches under the feet at the stance (it holds the rifle, the test is the hands): fix.stance off keeps the
// stance where the session's was (skills/stance.js would slide it 0.2 m back out of the stand).
export const rifleSpec = (grasp, keys) => ({
	schema: "cozyclay.motion-spec.v1", fps: 24, frames: 200, fix: { stance: false },
	use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } },
		{ skill: "reachGrip", f0: 8, args: { anchor: "grip", side: "r", reach: 22, hold: 158, define: { kind: "object", object: "pgrip", ...(grasp ? { grasp } : { local: [0, 0.06, 0] }) } } },
		{ skill: "reachGrip", f0: 12, args: { anchor: "fore", side: "l", reach: 24, hold: 152, define: { kind: "object", object: "mag", ...(grasp ? { grasp } : { local: [0, 0.08, 0] }) } } },
		{ skill: "walkTo", f0: 40, args: { to: [0.12, 2.6], step: 0.45 } }],
	...(keys ? { objects: { rifle: { prop: "gripGrip", grab: 30, keys } } } : {}),
});
