// The cup-on-a-table scene of the motion API v3.1 baseline session (the agent built it with
// arrange_objects; ids, names, positions and scales are the session's records). A table group
// `empty` (top `cube`, legs `cube-2`..`cube-5`) holds the cup group `empty-2` (body `cylinder`,
// handle `cube-6` grip, `cube-7` top, `cube-8` bottom), nested under it. Units: metres, +Y up,
// a record's position is its base pivot (bottom centre); every primitive is 1 m at scale 1.
// The character `char-a` is a Y Bot at the origin facing +Z, the table 0.85..1.15 m ahead.

// [id, name, renderer, parent, x, y, z, scaleX, scaleY, scaleZ]
const RECORDS = [
	["empty", "Table", "empty", null, 0, 0, 1, 1, 1, 1],
	["cube", "Table Top", "cube", "empty", 0, 0.71, 1, 1.2, 0.04, 0.8],
	["cube-2", "Leg FL", "cube", "empty", 0.54, 0, 1.34, 0.06, 0.73, 0.06],
	["cube-3", "Leg FR", "cube", "empty", -0.54, 0, 1.34, 0.06, 0.73, 0.06],
	["cube-4", "Leg BL", "cube", "empty", 0.54, 0, 0.66, 0.06, 0.73, 0.06],
	["cube-5", "Leg BR", "cube", "empty", -0.54, 0, 0.66, 0.06, 0.73, 0.06],
	["empty-2", "Cup", "empty", "empty", 0.2, 0.75, 0.85, 1, 1, 1],
	["cylinder", "Cup Body", "cylinder", "empty-2", 0.2, 0.75, 0.85, 0.08, 0.1, 0.08],
	["cube-6", "Cup Handle Grip", "cube", "empty-2", 0.268, 0.77, 0.85, 0.012, 0.06, 0.015],
	["cube-7", "Cup Handle Top", "cube", "empty-2", 0.2505, 0.814, 0.85, 0.031, 0.012, 0.012],
	["cube-8", "Cup Handle Bottom", "cube", "empty-2", 0.2505, 0.774, 0.85, 0.031, 0.012, 0.012],
];

export const SCENE_OBJECTS = RECORDS.map(([id, name, renderer, parent, x, y, z, scaleX, scaleY, scaleZ]) => ({
	id, name, renderer, ...(parent ? { parent } : {}), x, y, z, rot: 0, rotX: 0, rotZ: 0, scaleX, scaleY, scaleZ,
	footprint: { width: 1, depth: 1 }, height: 1,
}));

/** The cup group and its parts, as the session named them. */
export const CUP = { group: "empty-2", parts: ["cylinder", "cube-6", "cube-7", "cube-8"], table: "empty" };

export const CHARACTER = { id: "char-a", model: "y-bot-tpose", subject: "a young woman in a tan coat", x: 0, y: 0, z: 0, rot: 0, scale: 1 };
