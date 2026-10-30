/**
 * Glow: a record that gives off light of its own, drawn in one pass.
 *
 * There is no post-processing anywhere (the viewport, the shot preview,
 * capture_frame, contact sheets and the video export all render the scene with
 * one gl.render), so a bloom pass would have to be bolted onto every path.
 * Instead a glow is two single-pass parts, both on the default layer:
 *   - an emissive colour on every material the record draws, which no stage
 *     light can darken, and
 *   - an additive, camera-facing halo sprite centred on the record, `halo` ×
 *     the record's radius. It writes no depth, casts no shadow and is never
 *     raycast, so it cannot occlude, shadow or be picked.
 * Both scale with `gain` (the take's level, times a light's flicker).
 * A glowing record is self-lit, so its meshes cast no shadow while it glows: a
 * practical light placed inside a glowing bulb or flame lights the set instead
 * of being shut in by the bulb's own faces (light-blockers.js).
 *
 * State is kept per group in a WeakMap, never in `userData` (React replaces a
 * group's userData on every render). Removing the glow restores each
 * material's own emissive and drops the halo.
 */

import * as THREE from "three";

/** Halo brightness per unit of glow intensity. */
const HALO_GAIN = 0.2;
/** Radius used for a record with no size of its own (a light, an Empty), metres. */
const POINT_RADIUS = 0.02;
const noRaycast = () => {};
const glowStates = new WeakMap();

/** True while the group carries a glow that a later frame may have to remove. */
export function hasGlow(group) {
	return glowStates.has(group);
}

let haloMap = null;
/** A white disc whose alpha is a bright core over a long soft tail. */
function haloTexture() {
	if (haloMap) return haloMap;
	const size = 64;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
			const tail = r >= 1 ? 0 : (1 - r) ** 1.6;
			const alpha = Math.min(1, 0.7 * Math.exp(-((r / 0.25) ** 2)) + 0.5 * tail);
			data.set([255, 255, 255, Math.round(alpha * 255)], (y * size + x) * 4);
		}
	}
	haloMap = new THREE.DataTexture(data, size, size);
	haloMap.magFilter = THREE.LinearFilter;
	haloMap.minFilter = THREE.LinearFilter;
	haloMap.needsUpdate = true;
	return haloMap;
}

function makeHalo() {
	const material = new THREE.SpriteMaterial({ map: haloTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
	const halo = new THREE.Sprite(material);
	halo.userData.glowHalo = true;
	// Beauty render only: the ink prepass and the depth/normal passes draw with
	// an override material, which would turn the soft halo into a solid quad.
	halo.userData.beautyOnly = true;
	halo.raycast = noRaycast;
	halo.castShadow = false;
	halo.receiveShadow = false;
	halo.renderOrder = 2;
	return halo;
}

/** Each mesh the record draws on the default layer, and each of its lit
 * materials (editor markers and the halo itself are left alone). */
function forEachGlowMesh(group, visitMesh, visitMaterial) {
	group.traverse((node) => {
		if (!node.isMesh || !node.layers.isEnabled(0)) return;
		visitMesh(node);
		for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
			if (material?.emissive?.isColor) visitMaterial(material);
		}
	});
}

function clearGlow(group, state) {
	for (const [material, base] of state.bases) {
		material.emissive.copy(base.emissive);
		material.emissiveIntensity = base.intensity;
	}
	for (const mesh of state.shadowless) mesh.castShadow = true;
	state.halo.removeFromParent();
	state.halo.material.dispose();
	glowStates.delete(group);
}

/** The record's centre (local) and its radius (world): half its largest
 * extent, so a sphere's radius is exact; a record with no size (a light, an
 * Empty) counts as POINT_RADIUS. Size comes from the record, the same numbers
 * the selection cage and the plan use. */
function recordSphere(object, scale) {
	const width = (object.footprint?.width ?? 0) * Math.abs(scale.x);
	const height = (object.height ?? 0) * Math.abs(scale.y);
	const depth = (object.footprint?.depth ?? 0) * Math.abs(scale.z);
	const radius = Math.max(width, height, depth) / 2;
	return { centreY: (object.height ?? 0) / 2, radius: radius > 0 ? radius : POINT_RADIUS };
}

/** Apply, update or remove the record's glow for this frame. */
export function placeObjectGlow(group, object, gain) {
	const glow = object.glow;
	let state = glowStates.get(group);
	if (!glow) {
		if (state) clearGlow(group, state);
		return;
	}
	if (!state) {
		state = { halo: makeHalo(), bases: new Map(), shadowless: new Set() };
		glowStates.set(group, state);
	}
	if (state.halo.parent !== group) group.add(state.halo);
	const strength = glow.intensity * gain;
	forEachGlowMesh(group, (mesh) => {
		// a mesh rebuilt while glowing (a new kind, a loaded file) casts again until this pass
		if (!mesh.castShadow) return;
		mesh.castShadow = false;
		state.shadowless.add(mesh);
	}, (material) => {
		if (!state.bases.has(material)) state.bases.set(material, { emissive: material.emissive.clone(), intensity: material.emissiveIntensity });
		material.emissive.set(glow.color);
		material.emissiveIntensity = strength;
	});
	const { centreY, radius } = recordSphere(object, group.scale);
	const size = 2 * radius * glow.halo * gain;
	const halo = state.halo;
	halo.visible = size > 0 && strength > 0;
	halo.position.set(0, centreY, 0);
	// The sprite inherits the record's scale; divide it out so the halo stays round.
	halo.scale.set(size / (Math.abs(group.scale.x) || 1), size / (Math.abs(group.scale.y) || 1), 1);
	halo.material.color.set(glow.color).multiplyScalar(HALO_GAIN * strength);
}
