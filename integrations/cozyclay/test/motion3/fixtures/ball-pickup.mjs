// Session 7f15b4ae turn 2 ("공을 잡아서 들어올려봐"): the ball kit on a table, picked up with reachGrip and lifted on keys.
// The session installed it at QA 0 with every goal met while the ball rode the finger middles (#816). Rebuilt here on
// a Y Bot with the stance standIdle picks within reach and a 25 deg lean: QA 0 on today's compiler, the ball 2.4 cm
// off the finger middles from the grab on. Records: units metres, +Y up, a record's position its base pivot; the ball
// kit's root is the ball's centre.
import { buildKit } from "../../../src/kits/index.js";

const B = [-0.2, 0.79, 0.41], UP = [-0.17, 1.05, 0.28];

export const MODEL = "y-bot-tpose";
const table = { id: "table", name: "Table", renderer: "cube", x: -0.2, y: 0, z: 0.7, rot: 0, rotX: 0, rotZ: 0, scaleX: 0.6, scaleY: 0.75, scaleZ: 0.6,
	footprint: { width: 1, depth: 1 }, height: 1 };
const kit = buildKit("ball", [table], { position: { x: B[0], y: B[1], z: B[2] } });
export const BALL = kit.rootId;
export const BALL_SCENE = [table, ...kit.records];

/** The session's installed spec; `objects` replaces the ball's entry (fix, grasp, mass: the test's). */
export const ballPickupSpec = ({ fix, entry = {} } = {}) => ({
	schema: "cozyclay.motion-spec.v1", fps: 24, frames: 86, label: "grab and lift ball",
	props: { ballGrip: { hand: "r", origin: ["RightHandIndex2", "RightHandMiddle2"], points: { centre: [0, 0, -0.035] } } },
	anchors: { orb: { kind: "world", p: B } },
	keys: [{ f: 10, set: { spine_pitch: 0 } }, { f: 28, set: { spine_pitch: 25 } }, { f: 34, set: { spine_pitch: 25 } }, { f: 56, set: { spine_pitch: 0 } }],
	use: [{ skill: "standIdle", args: { heading: 0 }, f0: 0 }, { skill: "reachGrip", args: { anchor: "orb", side: "r", reach: 20, hold: 4, release: 12 }, f0: 10 }],
	objects: { [BALL]: { prop: "ballGrip", grab: 30, keys: [{ f: 32, pos: B }, { f: 56, pos: UP }, { f: 84, pos: UP }], ...entry } },
	...(fix !== undefined ? { fix } : {}),
});
