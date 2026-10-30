/**
 * The per-frame half of practical lights and glow, kept free of React so the
 * place pass can be exercised in Node: SceneObject calls `placeObjectLook`
 * from its imperative place pass (and the recorder through it, for every
 * frame it renders), and it writes the light's numbers and the glow for that
 * frame only.
 */

import * as THREE from "three";
import { LIGHT_INTENSITY_SCALE, flickerAt } from "./object-look.js";
import { trackLevel } from "./object-travel.js";
import { hasGlow, placeObjectGlow } from "./object-glow.js";

const DEG = Math.PI / 180;
/** A shadow camera's far plane when the light has no range of its own. */
export const SHADOW_FAR = 40;

const DOWN = new THREE.Vector3(0, -1, 0);
const scratchDir = new THREE.Vector3();
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();

function childWith(group, key) {
	for (const child of group.children) if (child.userData?.[key]) return child;
	return null;
}

/** Write the light's numbers for this frame. `gain` is level × flicker. */
function placeSceneLight(group, object, gain) {
	const light = childWith(group, "sceneLight");
	if (!light) return;
	const { color, intensity, range, angle, softness, aim } = object.light;
	light.color.set(color);
	light.intensity = intensity * LIGHT_INTENSITY_SCALE * gain;
	light.distance = range;
	if (light.castShadow && light.isPointLight) {
		const far = range > 0 ? range : SHADOW_FAR;
		if (light.shadow.camera.far !== far) {
			light.shadow.camera.far = far;
			light.shadow.camera.updateProjectionMatrix();
		}
	}
	if (!light.isSpotLight) return;
	light.angle = angle * DEG;
	light.penumbra = softness;
	// The target is kept outside the scene graph, in world space: an aim point
	// is a place in the set, and the record's own -Y is where it hangs pointing.
	group.updateWorldMatrix(true, false);
	group.matrixWorld.decompose(scratchPos, scratchQuat, scratchScale);
	if (aim) scratchDir.set(aim.x - scratchPos.x, aim.y - scratchPos.y, aim.z - scratchPos.z);
	else scratchDir.copy(DOWN).applyQuaternion(scratchQuat);
	if (scratchDir.lengthSq() < 1e-10) scratchDir.copy(DOWN).applyQuaternion(scratchQuat);
	scratchDir.normalize();
	light.target.position.copy(scratchPos).add(scratchDir);
	light.target.updateMatrixWorld();
	const cone = childWith(group, "lightMarker")?.children.find((child) => child.userData?.lightCone);
	if (cone) cone.quaternion.setFromUnitVectors(DOWN, scratchDir.applyQuaternion(scratchQuat.invert()));
}

/**
 * The per-frame look of one record: its light (if it is one) and its glow (if
 * it has one), from the take's level at `frame` and the light's flicker. Pure
 * in the frame number, so any frame can be drawn in any order.
 */
export function placeObjectLook(group, object, frame, take) {
	if (!object.light && !object.glow && !hasGlow(group)) return;
	const level = trackLevel(object.id, frame, take);
	const gain = level * (object.light ? flickerAt(object.id, frame, object.light.flicker, take?.fps) : 1);
	if (object.light) placeSceneLight(group, object, gain);
	placeObjectGlow(group, object, gain);
}
