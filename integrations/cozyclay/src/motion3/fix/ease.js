// Small helpers the auto-fixes share.

/** Eased dilation of a per-frame amount: every frame gets at least amount * ease over +-w frames. */
export function easeAround(values, w) {
	const n = values.length, out = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		if (!(values[i] > 0)) continue;
		for (let j = Math.max(0, i - w - 1); j <= Math.min(n - 1, i + w + 1); j++) {
			const t = 1 - Math.abs(i - j) / (w + 1), e = t * t * (3 - 2 * t);
			out[j] = Math.max(out[j], values[i] * e);
		}
	}
	return out;
}

export const round4 = x => Math.round(x * 1e4) / 1e4;
