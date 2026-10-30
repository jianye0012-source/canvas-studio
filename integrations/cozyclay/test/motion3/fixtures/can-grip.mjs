// A 6.6 cm can on a stand at chest height, reached with an object anchor that takes a power grasp (its thin-body
// socket): the hand wraps it where it stands (#816). Records: units metres, +Y up, a record's position its base pivot.
const box = (id, name, renderer, x, y, z, sx, sy, sz) => ({ id, name, renderer, x, y, z, rot: 0, rotX: 0, rotZ: 0, scaleX: sx, scaleY: sy, scaleZ: sz, footprint: { width: 1, depth: 1 }, height: 1 });
export const CAN_SCENE = [box("stand", "Stand", "cube", 0.05, 0, 0.42, 0.3, 0.9, 0.3), box("can", "Can", "cylinder", -0.05, 0.9, 0.42, 0.066, 0.12, 0.066)];

export const canGripSpec = fix => ({
	schema: "cozyclay.motion-spec.v1", fps: 24, frames: 60,
	anchors: { canGrip: { kind: "object", object: "can", grasp: "power" } },
	use: [{ skill: "standIdle", args: { heading: 0 }, f0: 0 }, { skill: "reachGrip", args: { anchor: "canGrip", side: "r", reach: 20, hold: 20, release: 12 }, f0: 5 }],
	...(fix ? { fix } : {}),
});
