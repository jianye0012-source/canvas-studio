import { useMemo } from "react";
import { buildShotCameraTracks, castAimPoint, followSubjectTrack } from "./camera-direction.js";

/** The per-frame follow/rail camera of every shot (camera-direction.js), rebuilt
 * when the shots, the subject's path or the cast a rail aims at change. */
export function useShotCameraTracks({ shots, subjectTrack, subjectId, fps, yawDeg, filmback, characters, objects, frameCount, activeId, motion }) {
	return useMemo(() => {
		if (!subjectTrack) return null;
		const cast = { characters, objects, shots, frameCount, fps, clipOf: (entry) => (entry.id === activeId ? motion : entry.sessionMotion) };
		return buildShotCameraTracks({ shots, subjectTrack: followSubjectTrack(subjectTrack, subjectId, cast), fps, yawDeg, filmback, aimAt: (id, frame) => castAimPoint(id, frame, cast) });
	}, [shots, subjectTrack, subjectId, fps, yawDeg, filmback, characters, objects, frameCount, activeId, motion]);
}
