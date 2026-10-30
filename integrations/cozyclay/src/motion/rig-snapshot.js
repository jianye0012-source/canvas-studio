// Bone transform snapshots for a rig: playback writes bone rotations (and the hips position),
// so starting or clearing a take captures every bone first and restores the prior pose exactly.

/** Capture the local position and quaternion of every bone in the rig. */
export function snapshotPlaybackBones(rig) {
	const out = [];
	rig.traverse((bone) => {
		if (!bone.isBone) return;
		out.push([bone, bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w, bone.position.x, bone.position.y, bone.position.z]);
	});
	return out;
}

/** Restore transforms captured by snapshotPlaybackBones. */
export function restorePlaybackBones(rig, snapshot) {
	if (!rig || !snapshot) return;
	for (const entry of snapshot) {
		entry[0].quaternion.set(entry[1], entry[2], entry[3], entry[4]);
		if (entry.length > 5) entry[0].position.set(entry[5], entry[6], entry[7]);
	}
	rig.updateMatrixWorld(true);
}
