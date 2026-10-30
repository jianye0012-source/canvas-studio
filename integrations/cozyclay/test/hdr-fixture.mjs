// A test HDR environment written from scratch: a small Radiance RGBE encoder
// (flat scanlines, which every reader accepts) and an equirectangular map with
// a dim blue sky, a grey ground and one bright sun spot. The browser QA loads
// the file through the Light panel; the Node test decodes it.

/** RGB floats (rows top-down, as a Radiance file stores them) to a valid .hdr file. */
export function encodeRgbe(width, height, rgb) {
	const header = new TextEncoder().encode(`#?RADIANCE\n# CozyClay test map\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
	const bytes = new Uint8Array(header.length + width * height * 4);
	bytes.set(header);
	for (let i = 0; i < width * height; i++) {
		const [r, g, b] = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]], peak = Math.max(r, g, b), at = header.length + i * 4;
		if (peak < 1e-32) continue;
		const exponent = Math.ceil(Math.log2(peak)) + (peak === 2 ** Math.ceil(Math.log2(peak)) ? 1 : 0), scale = 256 / 2 ** exponent;
		bytes.set([Math.min(255, Math.floor(r * scale)), Math.min(255, Math.floor(g * scale)), Math.min(255, Math.floor(b * scale)), exponent + 128], at);
	}
	return bytes;
}

/**
 * The map: sky (0.05, 0.07, 0.12), ground (0.04, 0.04, 0.04), and a sun of
 * radiance `sun` within `radius` degrees of azimuth `az` / elevation `el`
 * (azimuth 0 = +x, 90 = +z, the way three samples an equirectangular map).
 * Answers { width, height, rgb } with rows top-down.
 */
export function sunSpotMap({ width = 256, height = 128, az = 0, el = 20, radius = 6, sun = 40 } = {}) {
	const D = Math.PI / 180, rgb = new Float32Array(width * height * 3);
	const centre = [Math.cos(el * D) * Math.cos(az * D), Math.sin(el * D), Math.cos(el * D) * Math.sin(az * D)];
	for (let row = 0; row < height; row++) {
		const elevation = (0.5 - (row + 0.5) / height) * Math.PI;
		for (let column = 0; column < width; column++) {
			const azimuth = ((column + 0.5) / width - 0.5) * 2 * Math.PI;
			const dir = [Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth)];
			const lit = Math.acos(Math.min(1, dir[0] * centre[0] + dir[1] * centre[1] + dir[2] * centre[2])) / D < radius;
			const colour = lit ? [sun, sun * 0.95, sun * 0.85] : elevation >= 0 ? [0.05, 0.07, 0.12] : [0.04, 0.04, 0.04];
			rgb.set(colour, (row * width + column) * 3);
		}
	}
	return { width, height, rgb };
}
