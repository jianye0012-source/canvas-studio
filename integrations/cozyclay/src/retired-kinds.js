// Object kinds an old project can carry that this build no longer ships.

/**
 * Kinds an earlier build shipped and this one does not (hand-built set
 * pieces), with the standing size they had. They exist only so an old project
 * still opens: each record becomes a plain cube with the same transform and
 * the same size, so its blocking, collisions, route and children survive.
 */
const RETIRED_KINDS = Object.freeze({
	chair: { width: 0.6, depth: 0.6, height: 1.15 },
	car: { width: 1.8, depth: 4.5, height: 1.4 },
	"small-plane": { width: 3.4, depth: 3.6, height: 1.4 },
});

/** A stored record of a retired kind as the cube that stands in for it; any
 * other record is returned untouched. Scale absorbs the retired footprint, the
 * same single-`scale` fallback normalizeSceneObject reads applies first. */
export function retireObjectKind(record) {
	const size = record && typeof record === "object" ? RETIRED_KINDS[record.renderer] : undefined;
	if (!size) return record;
	const single = record.scaleX === undefined && record.scaleY === undefined && record.scaleZ === undefined ? Number(record.scale) : NaN;
	const axis = (value) => {
		const n = value === undefined ? (Number.isFinite(single) ? single : 1) : Number(value);
		return Number.isFinite(n) ? n : 1;
	};
	const { scale: _scale, ...rest } = record;
	return {
		...rest,
		renderer: "cube",
		scaleX: axis(record.scaleX) * size.width,
		scaleY: axis(record.scaleY) * size.height,
		scaleZ: axis(record.scaleZ) * size.depth,
		footprint: { width: 1, depth: 1 },
		height: 1,
		supportY: 1,
	};
}
