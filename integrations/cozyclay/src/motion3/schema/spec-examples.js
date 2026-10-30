// motion.describe { topic: "examples" }: whole specs, each compiled at QA 0 on the scene its `scene`
// line names (test/bus/verify-motion3-examples.mjs builds those scenes and compiles every spec on
// both rigs). They come from the skills' and kits' own examples: reachGrip, smokeCigarette with
// args.kit and the squat of the smoke pacing test, the sword kit's props and carry, a hinge.
// Kept out of essentials (its budget is spent).
const SCHEMA = "cozyclay.motion-spec.v1";

export const SPEC_EXAMPLES = [
	{ name: "reachGrip carry: take a lantern off its hook and walk off with it",
		scene: "lantern: a 14 x 20 x 14 cm box hanging at (0.3, 0.95, 0.4); the character at the origin, yaw 0",
		spec: { schema: SCHEMA, fps: 24, frames: "auto", label: "take the lantern and walk off",
			use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } },
				{ skill: "reachGrip", f0: 10, args: { anchor: "handle", side: "l", define: { kind: "object", object: "lantern", local: [0, 0.22, 0] } } },
				{ skill: "walkTo", f0: 70, args: { to: [0, 1.6], steps: 4 } }],
			objects: { lantern: { prop: "handleGrip", grab: 30 } },
			goals: [{ name: "lantern carried off", moved: "object:lantern", by: 0.8, at: [170, 184] }] } },
	{ name: "squat and smoke, dressed by kits (smokeCigarette args.kit)",
		scene: "object.createKit cigarette, lighter and exhale answered rootIds cig, lighter, exhale",
		spec: { schema: SCHEMA, fps: 24, frames: 240, label: "squat and smoke",
			keys: [{ f: 0, set: { root: [0, 0.45, -0.12], yaw: 0, pitch: 22, spine_pitch: 10, head_pitch: -12, foot_l: [0.16, 0.101, 0.02], foot_r: [-0.16, 0.101, 0.02],
				fyaw_l: 15, fyaw_r: -15, knee_l: [0.45, 0, 1], knee_r: [-0.45, 0, 1] } }],
			use: [{ skill: "smokeCigarette", f0: 1, args: { kit: { cig: "cig", lighter: "lighter", exhale: "exhale" } } }], fix: { retime: true },
			goals: [{ name: "cigarette at the mouth", near: ["prop:cig.origin", "landmark:mouth"], tol: 0.08, at: [40, 230], mode: "any" }] } },
	{ name: "aim keys: raise a held sword to guard, then point it at a target",
		scene: "object.createKit sword answered rootId sword and the props and bind below",
		spec: { schema: SCHEMA, fps: 24, frames: 60, label: "sword to guard, then point",
			use: [{ skill: "standIdle", f0: 0, args: { at: [0, 0], heading: 0 } }],
			props: { swordGrip: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { tip: [0, 0.87, -0.015] } } },
			anchors: { target: { kind: "world", p: [-0.25, 1.52, 1.13] } },
			objects: { sword: { prop: "swordGrip", at: [0, 0, -0.015], along: [0, 1, 0], keys: [{ f: 20, pos: [-0.25, 1, 0.35], aim: [0, 0.7, 0.7] },
				{ f: 40, pos: [-0.25, 1.05, 0.4], aim: [0, 0.55, 0.85] }, { f: 59, pos: [-0.25, 1.05, 0.4], aim: [0, 0.55, 0.85] }] } },
			goals: [{ name: "blade points at the target", near: ["prop:swordGrip.tip", "anchor:target"], tol: 0.1, at: [40, 59] }] } },
	{ name: "hinge: push a door open by its knob",
		scene: "door: a 0.9 x 2 x 0.04 m box, base at (0, 0, 0.75), hinged on its +x edge",
		spec: { schema: SCHEMA, fps: 24, frames: 72, label: "push the door open",
			use: [{ skill: "standIdle", f0: 0, args: { at: [-0.1, 0.45], heading: 0 } },
				{ skill: "reachGrip", f0: 5, args: { anchor: "knob", side: "r", hold: 15, release: 8, define: { kind: "object", object: "door", local: [-0.35, 1, -0.04] } } }],
			objects: { door: { pivot: [0.45, 0, 0.75], axis: [0, 1, 0], channel: "door" } },
			keys: [{ f: 25, set: { door: 0 } }, { f: 40, set: { door: 10 } }, { f: 48, set: { door: 15 } }, { f: 70, set: { door: 75 } }],
			goals: [{ name: "door swung open", moved: "object:door", by: 0.3, at: [60, 71] }] } },
];

export const EXAMPLE_NOTES = [
	"Each spec compiles at QA 0 on its scene. Ids are examples: use the scene's (object.createKit answers rootId, props and bind).",
	"The lantern rides the hand from grab on (no release); the knob anchor follows the hinged door; aim keys pose the sword, the arm follows; the last key holds the pose.",
];
