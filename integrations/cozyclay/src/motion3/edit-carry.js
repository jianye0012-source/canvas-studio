// A take's timing edit (take-edit.js: cuts, segment speeds, removed segments, a trim) carried onto the
// next take compiled for the same character, so a recompile does not throw away timing the user (or
// the agent) set on the take it replaces and nobody has to cut and slow it again by hand.
// The segments keep their source frames (a recompile mostly keeps its beats where they were): the
// same frame count keeps the edit as it is; on another count a segment that ran to the old last frame
// runs to the new one, segments past the new end drop out and one across it is clipped.
import { isIdentityEdit, normalizeTakeEdit } from "./take-edit.js";

const RESET = "motion.resetTiming plays the take as compiled";

/** carryEdit(edit, oldFrames, newFrames) -> null (nothing to carry) | { edit (null: dropped), note }. */
export function carryEdit(edit, oldFrames, newFrames) {
	const previous = normalizeTakeEdit(edit, oldFrames);
	if (!previous || isIdentityEdit(previous, oldFrames)) return null;
	if (oldFrames === newFrames) return { edit: previous, note: `kept the timing edit of the take it replaced (${previous.length} segments); ${RESET}` };
	const last = newFrames - 1, final = previous.length - 1;
	const next = previous.map((segment, i) => ({ ...segment, sourceEnd: i === final && segment.sourceEnd === oldFrames - 1 ? last : Math.min(segment.sourceEnd, last) }))
		.filter(segment => segment.sourceStart <= segment.sourceEnd);
	if (!next.length || isIdentityEdit(next, newFrames)) return { edit: null, note: `dropped the timing edit of the take it replaced: nothing of it is left on the new ${newFrames} frames (it had ${oldFrames})` };
	return { edit: next, note: `kept the timing edit of the take it replaced (${next.length} segments) on the new ${newFrames} frames (it had ${oldFrames}); ${RESET}` };
}
