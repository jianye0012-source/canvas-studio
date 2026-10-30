// Timing edits on an installed take v3: the take is cut into segments, each playing a SOURCE
// frame range at its own speed (0.1x..4x), and segments can be removed or the take trimmed.
// The edit never touches the compiled take: renderTakeEdit resamples the source arrays (local
// bone quaternions, hips, object tracks) onto the timeline, so undo, reload and a new compile
// all start from the same untouched source. Frame numbers the timeline shows are edited frames;
// keys pinned to them (IK corrections) ride remapFrameKeys when the edit changes.

const SPEED_MIN = 0.1, SPEED_MAX = 4, SPEED_STEP = 0.1;
export const TRIM_MIN_FRAMES = 12;
const normalizeSpeed = speed => Number((Math.round(Number(speed) / SPEED_STEP) * SPEED_STEP).toFixed(1));
const sourceFrames = segment => segment.sourceEnd - segment.sourceStart + 1;
const timelineFrames = segment => Math.max(1, Math.round(sourceFrames(segment) / segment.speed));

export function createTakeEdit(frames) {
	if (!Number.isInteger(frames) || frames < 1) throw new Error("createTakeEdit: frames must be a positive integer");
	return [{ id: "motion-0", sourceStart: 0, sourceEnd: frames - 1, speed: 1 }];
}

export const takeEditDuration = edit => (Array.isArray(edit) ? edit.reduce((total, segment) => total + timelineFrames(segment), 0) : 0);

/** Each segment with where it sits on the timeline (inclusive frames). */
export function takeEditLayout(edit) {
	let cursor = 0;
	return edit.map(segment => {
		const frames = timelineFrames(segment), item = { ...segment, timelineStart: cursor, timelineEnd: cursor + frames - 1, timelineFrames: frames };
		cursor += frames;
		return item;
	});
}

/** The (fractional) source frame a timeline frame shows. */
export function timelineToSource(edit, frame) {
	const layout = takeEditLayout(edit);
	const at = Math.max(0, Math.min(Number.isFinite(frame) ? frame : 0, layout.at(-1).timelineEnd));
	const segment = layout.find(item => at <= item.timelineEnd) ?? layout.at(-1);
	if (segment.timelineFrames <= 1) return segment.sourceStart;
	return segment.sourceStart + ((at - segment.timelineStart) / (segment.timelineFrames - 1)) * (segment.sourceEnd - segment.sourceStart);
}

/** The timeline frame that shows a source frame; null when no segment covers it (cut away). */
export function sourceToTimeline(edit, source) {
	const segment = takeEditLayout(edit).find(item => source >= item.sourceStart && source <= item.sourceEnd);
	if (!segment) return null;
	if (segment.sourceEnd === segment.sourceStart) return segment.timelineStart;
	return Math.round(segment.timelineStart + ((source - segment.sourceStart) / (segment.sourceEnd - segment.sourceStart)) * (segment.timelineFrames - 1));
}

const remapTimelineFrame = (previous, next, frame) => sourceToTimeline(next, timelineToSource(previous, frame));

/** Encoded frame keys ([{ frame, ... }]) through an edit change: the earlier old frame wins a
 * shared new frame, and keys whose source frames were cut away drop out. */
export function remapFrameKeys(keys, previous, next) {
	const out = new Map();
	for (const key of [...keys].sort((a, b) => a.frame - b.frame)) {
		const frame = remapTimelineFrame(previous, next, key.frame);
		if (frame !== null && !out.has(frame)) out.set(frame, { ...key, frame });
	}
	return [...out.values()];
}

/** Split the segment under timeline frame `frame` there. */
export function splitTakeEdit(edit, frame) {
	const layout = takeEditLayout(edit), cut = Math.round(frame);
	if (cut <= 0 || cut >= takeEditDuration(edit)) return edit;
	const index = layout.findIndex(segment => cut > segment.timelineStart && cut <= segment.timelineEnd);
	if (index < 0) return edit;
	const segment = layout[index];
	const sourceCut = Math.max(segment.sourceStart + 1, Math.min(segment.sourceEnd, Math.round(timelineToSource(edit, cut))));
	if (sourceCut > segment.sourceEnd) return edit;
	const next = [...edit];
	next.splice(index, 1,
		{ id: `${segment.id}-a`, sourceStart: segment.sourceStart, sourceEnd: sourceCut - 1, speed: segment.speed },
		{ id: `${segment.id}-b`, sourceStart: sourceCut, sourceEnd: segment.sourceEnd, speed: segment.speed });
	return next;
}

export function setSegmentSpeed(edit, id, speed) {
	const normalized = normalizeSpeed(speed);
	if (!Number.isFinite(normalized) || normalized < SPEED_MIN || normalized > SPEED_MAX) throw new Error(`speed must be between ${SPEED_MIN} and ${SPEED_MAX} in ${SPEED_STEP} steps`);
	return edit.map(segment => (segment.id === id ? { ...segment, speed: normalized } : segment));
}

/** Drop one segment; the last one stays (no motion is motion.clear's job). */
export function removeSegment(edit, id) {
	if (edit.length < 2) return edit;
	const next = edit.filter(segment => segment.id !== id);
	return next.length === edit.length ? edit : next;
}

/** The speed that plays a segment across `frames` timeline frames (the stretch grip). */
export function segmentSpeedForFrames(segment, frames) {
	const raw = sourceFrames(segment) / Math.max(1, Math.round(Number(frames) || 1));
	return normalizeSpeed(Math.min(SPEED_MAX, Math.max(SPEED_MIN, raw)));
}

/** Keep timeline frames start..end (inclusive) of the edited take. */
export function trimTakeEdit(edit, start, end) {
	const duration = takeEditDuration(edit);
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end >= duration || start > end) throw new Error(`trim range ${start}..${end} is outside 0..${duration - 1}`);
	return takeEditLayout(edit).flatMap(segment => {
		const from = Math.max(start, segment.timelineStart), to = Math.min(end, segment.timelineEnd);
		if (from > to) return [];
		const sourceStart = Math.max(segment.sourceStart, Math.ceil(timelineToSource(edit, from) - 1e-9));
		const sourceEnd = Math.min(segment.sourceEnd, Math.floor(timelineToSource(edit, to) + 1e-9));
		return sourceStart <= sourceEnd ? [{ id: `${segment.id}-t${sourceStart}`, sourceStart, sourceEnd, speed: segment.speed }] : [];
	});
}

export const isIdentityEdit = (edit, frames) => !edit || (edit.length === 1 && edit[0].sourceStart === 0 && edit[0].sourceEnd === frames - 1 && edit[0].speed === 1);

/** A saved edit checked against a take of `frames` source frames; null when it is not one. */
export function normalizeTakeEdit(value, frames) {
	if (!Array.isArray(value) || !value.length) return null;
	const ok = value.every(segment => segment && typeof segment.id === "string" && Number.isInteger(segment.sourceStart) && Number.isInteger(segment.sourceEnd)
		&& segment.sourceStart >= 0 && segment.sourceStart <= segment.sourceEnd && (!Number.isFinite(frames) || segment.sourceEnd < frames)
		&& Number.isFinite(segment.speed) && segment.speed >= SPEED_MIN && segment.speed <= SPEED_MAX);
	return ok ? value.map(({ id, sourceStart, sourceEnd, speed }) => ({ id, sourceStart, sourceEnd, speed })) : null;
}

function nlerp(out, o, a, ia, b, ib, t) {
	const sign = a[ia] * b[ib] + a[ia + 1] * b[ib + 1] + a[ia + 2] * b[ib + 2] + a[ia + 3] * b[ib + 3] < 0 ? -1 : 1;
	let n = 0;
	for (let k = 0; k < 4; k++) { out[o + k] = a[ia + k] * (1 - t) + b[ib + k] * sign * t; n += out[o + k] ** 2; }
	n = Math.sqrt(n) || 1;
	for (let k = 0; k < 4; k++) out[o + k] /= n;
}

function lerp(out, o, a, ia, b, ib, t, width) {
	for (let k = 0; k < width; k++) out[o + k] = a[ia + k] + (b[ib + k] - a[ia + k]) * t;
}

/** The take as the edit plays it: the same take object when there is no edit. */
export function renderTakeEdit(take) {
	const edit = take && !take.editRendered ? normalizeTakeEdit(take.edit, take.frameCount) : null;
	if (!edit || isIdentityEdit(edit, take.frameCount)) return take;
	const D = takeEditDuration(edit), B = take.bones.length, F = take.frameCount;
	const at = Array.from({ length: D }, (_, f) => {
		const s = timelineToSource(edit, f), i0 = Math.min(F - 1, Math.floor(s));
		return { i0, i1: Math.min(F - 1, i0 + 1), t: s - i0, near: Math.min(F - 1, Math.round(s)) };
	});
	const rot = new Float32Array(D * B * 4), hips = new Float32Array(D * 3);
	at.forEach(({ i0, i1, t }, f) => {
		for (let b = 0; b < B; b++) nlerp(rot, (f * B + b) * 4, take.rot, (i0 * B + b) * 4, take.rot, (i1 * B + b) * 4, t);
		lerp(hips, f * 3, take.hips, i0 * 3, take.hips, i1 * 3, t, 3);
	});
	const objects = Object.fromEntries(Object.entries(take.objects ?? {}).map(([id, track]) => {
		const next = {};
		if (track.pos) { next.pos = new Float32Array(D * 3); at.forEach(({ i0, i1, t }, f) => lerp(next.pos, f * 3, track.pos, i0 * 3, track.pos, i1 * 3, t, 3)); }
		if (track.quat) { next.quat = new Float32Array(D * 4); at.forEach(({ i0, i1, t }, f) => nlerp(next.quat, f * 4, track.quat, i0 * 4, track.quat, i1 * 4, t)); }
		if (track.lvl) { next.lvl = new Float32Array(D); at.forEach(({ i0, i1, t }, f) => lerp(next.lvl, f, track.lvl, i0, track.lvl, i1, t, 1)); }
		for (const key of ["vis", "hold", "world"]) if (track[key]) { next[key] = new Uint8Array(D); at.forEach(({ near }, f) => { next[key][f] = track[key][near]; }); }
		return [id, next];
	}));
	return { ...take, frameCount: D, frames: D, rot, hips, objects, edit, editRendered: true };
}
