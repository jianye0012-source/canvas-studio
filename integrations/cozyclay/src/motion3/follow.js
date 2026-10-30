// C16. Follow entries: spec.objects[id] = { follow: <ref>, offset?, aim?, visible?, level? } puts a
// record (a body, a group root, or a record with no box: an effect, a light, an Empty) on a point
// of the body at every frame. The ref is any point ref (refs.js): landmark:mouth, joint:<Bone>,
// prop:<prop>.<point>, anchor:<name>, object:<id> (an object a follow entry does not move).
//   aim     where the record's +Y points (effects emit along it): "up" (default, world up), "face"
//           (the face's forward direction, the Head bone's rest +Z, as checks.orient "face"), a
//           world direction [x, y, z], or a ref (toward that point). The record turns the shortest
//           way from upright onto it.
//   offset  metres along the record's own axes after aim (+Y along aim), from the ref point.
// The take bakes a world-space track at every frame (take.js: pos, quat and hold on every frame,
// so object-travel.js cuts the carry of the record's own parents), so the renderer and the effects
// (born at the emitter's pose at the birth frame) see the moving path. A follow entry is not an
// obstacle (compile.js marks its bodies carried) and QA checks it against nothing: it rides the body.
import { refPoint } from "./refs.js";
import { carried } from "./compiler/limbs.js";
import { add, sub, apply, norm, len, matFromQuat } from "./compiler/math.js";
import { arcQuat } from "./compiler/quat.js";

const UP = [0, 1, 0];

/** The unit direction aim gives at absolute frame f (inside the window), `from` the followed point. */
function aimDir(out, f, aim = "up", from) {
	if (Array.isArray(aim)) return norm(aim);
	if (aim === "face") { const { sk } = out.ctx; return norm(carried(sk, out.frames[f - (out.f0 ?? 0)].s, sk.index.Head, [0, 0, 1])); }
	const to = aim === "up" ? null : refPoint(out, f, aim), d = to ? sub(to, from) : UP;
	return len(d) > 1e-9 ? norm(d) : UP;
}

/**
 * World pose { pos, R } of the record follow entry o puts at absolute frame f of compile result
 * out (a frame outside the compiled window takes the nearest one in it), or null when the ref
 * has no point there.
 */
export function followPose(out, o, f) {
	const lo = out.f0 ?? 0, ff = Math.max(lo, Math.min(lo + out.frames.length - 1, f)), p = refPoint(out, ff, o.follow);
	if (!p) return null;
	const R = matFromQuat(arcQuat(UP, aimDir(out, ff, o.aim, p)));
	return { pos: add(p, apply(R, o.offset ?? [0, 0, 0])), R };
}
