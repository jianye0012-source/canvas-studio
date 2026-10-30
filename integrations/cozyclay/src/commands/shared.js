// Helpers the command modules share. `ports` is the editor's one generic port
// object: its members are read at call time, so a run always reaches the
// latest handlers and `ports.state()` the synchronously published document.
import { StudioProtocolError } from "../studio-agent-protocol.js";
import { POSE_BONES } from "../poses.js";

export const fail = (code, message) => { throw new StudioProtocolError(code, message); };

// A pose bone outside POSE_BONES is dropped by applyPose, so the pose falls back to the
// rest (T) pose for that joint. Refuse it and name the joints a pose can set (#773).
const POSE_BONE_IDS = POSE_BONES.map(entry => entry.id);
export function checkPoseBones(bones) {
	const unknown = Object.keys(bones ?? {}).filter(name => !POSE_BONE_IDS.includes(name));
	if (unknown.length) fail("INVALID_ARGUMENT", `Unknown pose bone ${unknown.join(", ")}. Use one of: ${POSE_BONE_IDS.join(", ")}.`);
}

/** Ids of the rows added, changed or removed between two renders of a list. */
export const changedIds = (before, after) => [...new Set([
	...after.filter(row => !before.includes(row)).map(row => row.id),
	...before.filter(row => !after.some(next => next.id === row.id)).map(row => row.id),
])];

export const shotLabel = shot => `${shot.name} [${shot.startFrame}, ${shot.endFrame + 1})`;

export const shotOf = (ports, shotId) => ports.state().shots.find(shot => shot.id === shotId) ?? fail("STALE_TARGET", `Shot ${shotId} is not in this scene.`);

export const characterOf = (ports, characterId) => ports.state().characters.find(entry => entry.id === characterId)
	?? fail("STALE_TARGET", `Character ${characterId} is not in this scene.`);
