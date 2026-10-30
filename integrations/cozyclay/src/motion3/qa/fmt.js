// Compact number formatting for QA hints (millimetre precision).
export const m3 = x => { const r = Math.round(x * 1000) / 1000; return Object.is(r, -0) ? 0 : r; };

/** Compact vector: [+0.021, 0, -0.004]. */
export const vec = v => `[${v.map(x => { const r = m3(x); return r > 0 ? `+${r}` : `${r}`; }).join(", ")}]`;
