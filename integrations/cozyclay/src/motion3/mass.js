// What a scene object weighs, kg, for the arm that holds it (#816). The spec says it (spec.objects[id].mass), else a
// small sphere is a ball (BALL kg: a baseball is 0.145), else its parts' volumes at DENSITY (wood, a filled box). A
// group weighs what its bodies do. Never a scene record field: motion-scene entries are saved with a take (shapes.js).
import { partsOf } from "./object-pose.js";
import { shapeOf } from "./shapes.js";

const BALL = 0.15, BALL_SIZE = 0.12, DENSITY = 400, MIN = 0.02, MAX = 60;

function volumeOf(entry) {
	const s = shapeOf(entry), h = entry.half;
	if (s.kind === "sphere") return (4 / 3) * Math.PI * s.r ** 3;
	if (s.kind === "cylinder") return Math.PI * s.r * s.r * s.h;
	return 8 * h[0] * h[1] * h[2];
}

export function massOf(spec, scene, id) {
	const given = spec?.objects?.[id]?.mass;
	if (Number.isFinite(given)) return given;
	const parts = partsOf(scene, id).map(k => scene.objects[k]);
	if (parts.length === 1 && shapeOf(parts[0]).kind === "sphere" && 2 * shapeOf(parts[0]).r < BALL_SIZE) return BALL;
	const kg = parts.reduce((sum, e) => sum + volumeOf(e) * DENSITY, 0);
	return Math.min(MAX, Math.max(MIN, kg));
}
