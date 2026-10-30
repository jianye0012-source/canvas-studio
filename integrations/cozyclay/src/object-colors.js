/**
 * The inspector's object colours: the blockout palette, what a typed colour
 * means, and the per-browser memory of hand-mixed tints. Pure, so the record
 * normalizers and the light/glow fields read the same hex rules.
 */

/** Blockout grey: what a primitive is until someone says otherwise. */
export const GREY_BOX = "#c2c6c8";

/** Blockout greys first, then the clay accents, then the blocking chromatics,
 * for re-tinting from the inspector. The greys lead because a blockout starts
 * grey; the saturated four exist so a shot can say "the red ball, the blue
 * box" at a glance — the inspector had no way to say that at all (#88). They
 * are muted off pure RGB so they still read as clay under the set's lighting.
 * Any other colour is authored through the inspector's free colour input. */
export const OBJECT_COLORS = [
	"#e2e5e6",
	GREY_BOX,
	"#9aa1a5",
	"#767d81",
	"#d9b18c",
	"#8fae9b",
	"#d94a4a",
	"#4a7bd9",
	"#e2c04a",
	"#4fa86a",
];

/** How many hand-mixed colours the inspector remembers. Six is one palette
 * row: enough to keep a scene's custom tints reachable, short enough that the
 * popover never turns into a second, unruly palette. */
const RECENT_OBJECT_COLORS_MAX = 6;
/** Session memory of hand-mixed tints; versioned like every other key here. */
const RECENT_OBJECT_COLORS_KEY = "cozyclay.objectColors.recent";

const HEX_SHORT = /^#?([0-9a-f]{3})$/i;
const HEX_LONG = /^#?([0-9a-f]{6})$/i;

/**
 * What a colour input typed by a human means, or null if it means nothing.
 *
 * The hex field accepts what people actually type — `#f36`, `ff3366`, upper
 * case, stray spaces — and folds it to the one form the record stores, so a
 * colour typed by hand and the same colour picked from the native swatch are
 * byte-identical (and therefore compare equal against the palette). Anything
 * else returns null rather than throwing or guessing: a half-typed `#12` is a
 * keystroke on the way somewhere, not an instruction to repaint the prop.
 */
export function normalizeObjectColor(value) {
	if (typeof value !== "string") return null;
	const text = value.trim();
	const short = HEX_SHORT.exec(text);
	if (short) return `#${short[1].toLowerCase().replace(/./g, (digit) => digit + digit)}`;
	const long = HEX_LONG.exec(text);
	return long ? `#${long[1].toLowerCase()}` : null;
}

/**
 * The recent-colours list after mixing `hex`: newest first, no duplicates,
 * capped, presets excluded.
 *
 * Pure so the list can be proved without a browser, and so a corrupt stored
 * list is repaired on the way through instead of painting a swatch with junk.
 * Presets are skipped because they are already one row up — remembering them
 * would push the author's own colours off the end with colours they never
 * mixed. Returns the SAME array when nothing changes, so a re-pick of an
 * unchanged colour cannot trigger a storage write or a re-render.
 */
export function rememberObjectColor(list, hex) {
	const clean = Array.isArray(list)
		? list.map(normalizeObjectColor).filter((color, index, all) => color && all.indexOf(color) === index && !OBJECT_COLORS.includes(color))
		: [];
	const color = normalizeObjectColor(hex);
	const next = color && !OBJECT_COLORS.includes(color) ? [color, ...clean.filter((entry) => entry !== color)] : clean;
	const capped = next.slice(0, RECENT_OBJECT_COLORS_MAX);
	const unchanged = Array.isArray(list) && capped.length === list.length && capped.every((entry, index) => entry === list[index]);
	return unchanged ? list : capped;
}

/** Recent colours as last left by this browser; storage can be unavailable
 * (private mode), and a corrupt body must not take the inspector down with
 * it — either way the palette simply starts without a memory. */
export function readStoredObjectColors(storage) {
	try {
		const parsed = JSON.parse(storage?.getItem(RECENT_OBJECT_COLORS_KEY) ?? "[]");
		return rememberObjectColor(Array.isArray(parsed) ? parsed : [], null);
	} catch {
		return [];
	}
}

export function writeStoredObjectColors(storage, list) {
	try {
		storage?.setItem(RECENT_OBJECT_COLORS_KEY, JSON.stringify(list));
	} catch {
		// Storage can be unavailable (private mode); the colours simply stop persisting.
	}
}
