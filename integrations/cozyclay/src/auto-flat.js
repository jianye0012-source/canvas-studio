/**
 * The viewport's auto-colour material: a solid-view response for
 * auto-coloured surfaces. A neutral studio shade lets the derived hue reach
 * the eye unmultiplied; under our warm key light a plain standard material
 * turns every hue olive. Full roughness kills the specular sheen and a
 * self-light of the same hue lifts the shadow side.
 */
export function autoFlat(hex) {
	return { color: hex, roughness: 1, metalness: 0, emissive: hex, emissiveIntensity: 0.4 };
}
