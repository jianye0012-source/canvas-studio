// Scene objects the installed takes animate (hinged doors and the like), for object-travel.js:
// id -> { frameCount, characterId, pos: Float32Array(F*3), quat: Float32Array(F*4), hold?, vis? } across the whole cast
// (characterId: whose take draws it, for motion.keyObject).
export function objectTracksOf(motionOwner, characters = []) {
	const tracks = new Map();
	for (const character of characters) {
		const take = motionOwner?.motionFor?.(character.id);
		if (take?.schema !== "cozyclay.take.v3") continue;
		for (const [id, track] of Object.entries(take.objects ?? {})) tracks.set(id, { frameCount: take.frameCount, characterId: character.id, ...track });
	}
	return tracks;
}
