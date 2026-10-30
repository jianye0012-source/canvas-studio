// The Shot Camera card's focal-length scrub (BottomDock ShotCard). The lens is
// stored as a vertical FOV (shotsDomain.changeLens takes degrees); the card
// speaks millimetres on the current filmback, the shot.js lens relation.
import { PRIME_SET } from "../shot.js";

// Editor lens range: shotsDomain.changeLens refuses FOVs outside 14-90°.
const FOV_MIN = 14, FOV_MAX = 90;
// px of horizontal drag per millimetre, and the Shift / Alt multipliers.
const PX_PER_MM = 4, FINE = 0.1, COARSE = 4;

const round1 = (value) => Math.round(value * 10) / 10;

export function fovDegToMm(fovDeg, sensorHeightMm) {
	return sensorHeightMm / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

export function mmToFovDeg(mm, sensorHeightMm) {
	return (2 * Math.atan(sensorHeightMm / (2 * mm)) * 180) / Math.PI;
}

/** The millimetre range the editor FOV range allows on this filmback. */
export function lensRange(sensorHeightMm) {
	return { min: round1(fovDegToMm(FOV_MAX, sensorHeightMm)) + 0.1, max: round1(fovDegToMm(FOV_MIN, sensorHeightMm)) - 0.1 };
}

export function clampMm(mm, range) {
	return round1(Math.min(range.max, Math.max(range.min, mm)));
}

/** The lens a horizontal drag of dx px from startMm lands on. */
export function dragMm(startMm, dx, { fine = false, coarse = false } = {}, range) {
	const scale = fine ? FINE : coarse ? COARSE : 1;
	return clampMm(startMm + (dx / PX_PER_MM) * scale, range);
}

/** A click steps to the next real prime in range, wrapping to the widest. */
export function nextPrime(mm, range) {
	const primes = PRIME_SET.filter((prime) => prime >= range.min && prime <= range.max);
	return primes.find((prime) => prime > mm + 0.05) ?? primes[0];
}

/** The left arrow steps back to the previous real prime, wrapping to the longest. */
export function previousPrime(mm, range) {
	const primes = PRIME_SET.filter((prime) => prime >= range.min && prime <= range.max);
	return [...primes].reverse().find((prime) => prime < mm - 0.05) ?? primes.at(-1);
}

export function formatMm(mm) {
	const value = round1(mm);
	return `${Number.isInteger(value) ? value : value.toFixed(1)} mm`;
}
