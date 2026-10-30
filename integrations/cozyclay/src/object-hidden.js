// Effective visibility of a scene record through its parents and its carrying
// character. Pure and dependency-free, so the renderers, the agent commands and
// the effects can share it; scene-objects.js re-exports it.

/** True when this record, a parent above it, or a character carrying any of
 *  those records is hidden. A cycle in parent links ends the walk. When the
 *  id is in `objects`, that stored record is what the walk reads, so a display
 *  copy cannot disagree with the authored flag. Nothing in the lists is changed. */
export function isEffectivelyHidden(entity, objects = [], characters = []) {
	if (!entity || typeof entity !== "object") return false;
	const byId = new Map();
	for (const object of objects) {
		if (object && typeof object.id === "string") byId.set(object.id, object);
	}
	const characterHidden = (id) => characters.some((item) => item && typeof item === "object" && item.id === id && item.hidden === true);
	const seen = new Set();
	let current = entity;
	while (current && typeof current === "object") {
		const id = typeof current.id === "string" ? current.id : null;
		if (id) {
			if (seen.has(id)) break;
			seen.add(id);
			if (byId.has(id)) current = byId.get(id);
		}
		if (current.hidden === true) return true;
		const characterId = current.attach && typeof current.attach.characterId === "string" ? current.attach.characterId : null;
		if (characterId && characterHidden(characterId)) return true;
		const parentId = typeof current.parent === "string" ? current.parent : null;
		if (!parentId) break;
		current = byId.get(parentId) ?? null;
	}
	return false;
}
