// A leaf module: the motion compiler's scene reader (motion3/scene.js) needs an object's size without
// scene-objects.js, which imports three; the agent sidecar reaches motion3 through motion.describe and must not.
/** The object's world size along each axis, for the gizmo and the plan board. */
export function objectSize(object) {
	return {
		width: (object.footprint?.width ?? 1) * (object.scaleX ?? 1),
		height: (object.height ?? 1) * (object.scaleY ?? 1),
		depth: (object.footprint?.depth ?? 1) * (object.scaleZ ?? 1),
	};
}
