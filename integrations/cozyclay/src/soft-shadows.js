// Soft key shadows in the same pass. three r185's PCF filter takes five taps
// on a Vogel disk of shadow.radius texels, rotated per pixel by interleaved
// gradient noise; past a radius of about two texels those five taps show as a
// cross-hatched grain over every penumbra. A wider radius (stage.lighting
// shadowSoftness) therefore takes SOFT_SHADOW_TAPS taps instead, which keeps
// the same disk and noise rotation but averages the grain away. Radius 1 —
// every stage before the look was authorable — runs the original five-tap code
// unchanged, so studio frames stay pixel-identical.
//
// Evaluated against the alternatives: PCFSoftShadowMap is deprecated in r185
// (it falls back to PCF); VSMShadowMap blurs smoothly but loses contact shadows
// (a leg's shadow on a box beside it vanished), cannot shadow point lights, and
// is renderer-wide, so it would restyle the studio look too.
import { ShaderChunk } from "three";

const SOFT_SHADOW_TAPS = 16;
const tap = (index) => `texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( ${index}, 5, phi ) * radius, shadowCoord.z ) )`;
const FIVE_TAPS = `shadow = (\n${[0, 1, 2, 3, 4].map((index) => `\t\t\t\t\t${tap(index)}`).join(" +\n")}\n\t\t\t\t) * 0.2;`;
const SOFT_TAPS = `if ( shadowRadius <= 1.0 ) {
					${FIVE_TAPS}
				} else {
					shadow = 0.0;
					for ( int i = 0; i < ${SOFT_SHADOW_TAPS}; i ++ ) shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, ${SOFT_SHADOW_TAPS}, phi ) * radius, shadowCoord.z ) );
					shadow /= ${SOFT_SHADOW_TAPS}.0;
				}`;

/** Patch the directional/spot PCF filter once; answers whether the soft path is in. */
export function installSoftShadows(chunks = ShaderChunk) {
	const source = chunks.shadowmap_pars_fragment;
	if (source.includes(SOFT_TAPS)) return true;
	// A three upgrade that rewrites the filter leaves the stock one in place.
	if (!source.includes(FIVE_TAPS)) return false;
	chunks.shadowmap_pars_fragment = source.replace(FIVE_TAPS, SOFT_TAPS);
	return true;
}

installSoftShadows();
