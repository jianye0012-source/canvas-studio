import assert from "node:assert/strict";
import * as THREE from "three";
import { supportDiagnostics, supportMotion, solveSupportForces } from "../../src/motion/physics-support.js";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function rows({ frames = 48, fps = 24, height = () => .3, centerX = 0, site = "leftFoot" } = {}) {
	return Array.from({ length: frames }, (_, f) => {
		const y = height(f / fps), root = V(centerX, y + 1, 0);
		const patch = [V(-.2, y, -.15), V(.2, y, -.15), V(.2, y, .15), V(-.2, y, .15)];
		return { root, com: root.clone(), support: { [site]: { floor: y, point: patch[0].clone(), position: V(0, y + .05, 0), patch, vertices: 20 } },
			dynamics: [{ mass: 1, center: root.clone(), rotation: new THREE.Quaternion(), axis: V(0, 1, 0), length: .5, radius: .1 }] };
	});
}
function shiftRows(source, shifts) {
	return source.map((r, f) => {
		const d = V(0, shifts[f], 0);
		return { ...r, com: r.com.clone().add(d), root: r.root.clone().add(d),
			dynamics: r.dynamics.map((s) => ({ ...s, center: s.center.clone().add(d) })),
			support: Object.fromEntries(Object.entries(r.support).map(([id, s]) => [id, { ...s, floor: s.floor + d.y, position: s.position.clone().add(d), point: s.point.clone().add(d), patch: s.patch.map((p) => p.clone().add(d)) }])) };
	});
}
for (const site of ["leftFoot", "leftHand", "leftKnee", "chest", "pelvis"]) {
	const input = rows({ site }), before = supportDiagnostics(input, 24);
	assert.equal(before.unsupportedFrames, 48, "no detected contact must not hide hovering");
	const after = supportDiagnostics(shiftRows(input, input.map(() => -.298)), 24);
	assert.equal(after.unsupportedFrames, 0); assert(after.forceResidual < .02); assert(after.momentResidual < .02);
}
console.log("PASS grounded feet, hands, knees, torso and pelvis are supported; absent contacts never mean zero error");
{
	const input = rows({ height: (t) => 1 + 3 * t - .5 * 9.81 * t * t, frames: 20 });
	const motion = supportMotion(input, 24);
	assert(motion.every((m) => m.force.length() < 1e-9));
	assert.equal(supportDiagnostics(input, 24).unsupportedFrames, 0);
}
console.log("PASS quadratic free flight including apex needs no support");
{
	const input = rows({ centerX: 1 });
	const demand = supportMotion(input, 24)[0];
	const fit = solveSupportForces(input[0], demand, Object.entries(input[0].support));
	assert(fit.momentResidual > .1 || fit.forceResidual > .22);
}
console.log("PASS force-only false support rejected by moment balance");
console.log("all pass");
