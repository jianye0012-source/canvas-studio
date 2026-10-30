/**
 * The `object.text` record: words standing in the set (a sign, a logo on a
 * truck's side). Pure data and clamps, shared by the object store, the agent
 * schema and the renderer (text-object.jsx).
 *
 * The record's box is measured from the words, never stored as a fact: x is
 * the centre, y = 0 the bottom of the lowest line, the letters face +z and
 * read toward +x. `size` is the height of a capital letter in metres.
 * `depth` 0 draws flat lettering in any script; above 0 the letters are
 * solid, extruded from the bundled typeface (Latin, digits, punctuation);
 * words with other characters stay flat.
 */
import { GREY_BOX } from "../object-colors.js";

export const TEXT_KIND = "text";

/** Advance widths of the bundled typeface (fonts/helvetiker-bold.typeface.json,
 * `ha` per glyph at resolution 1000, where a capital is 1013 tall) for the
 * printable ASCII characters 32..126. test/verify-text-object.mjs checks them
 * against the font file. */
const ASCII_ADVANCE = [375, 307, 454, 1117, 800, 1213, 1007, 289, 486, 486, 828, 828, 303, 525, 303, 828, 828, 828, 828, 828, 828, 828, 828, 828, 828, 828, 304, 306, 828, 828, 828, 785, 1374, 1069, 938, 1043, 968, 824, 778, 1057, 953, 365, 760, 996, 763, 1135, 949, 1094, 838, 1096, 947, 915, 894, 926, 997, 1399, 999, 931, 906, 444, 532, 446, 828, 828, 288, 786, 822, 828, 836, 808, 525, 839, 782, 326, 361, 771, 363, 1174, 782, 871, 824, 833, 513, 775, 511, 782, 828, 1150, 826, 828, 753, 599, 240, 597, 949];
/** The font's units per size (a capital is ~1 size tall), and the extent of
 * its ASCII glyphs above and below the baseline. */
export const TEXT_FONT = Object.freeze({ resolution: 1000, ascent: 1090, descent: 333 });
/** Baseline to baseline, in sizes. */
export const TEXT_LINE_PITCH = 1.5;
/** A wide (CJK, Hangul) character and any other character the font lacks, in sizes. */
const WIDE_ADVANCE = 1.25, OTHER_ADVANCE = 0.8;
/** Flat lettering is a card this thick (m): enough for a footprint and a pick. */
export const TEXT_FLAT_DEPTH = 0.005;

const LIMITS = { size: [0.02, 10], depth: [0, 2] };
const MAX_CHARS = 200, MAX_LINES = 8;
const ALIGNS = ["left", "center", "right"];
const DEFAULT_TEXT = Object.freeze({ value: "Text", size: 0.3, depth: 0, align: "center" });

export const TEXT_ENTRY = { kind: TEXT_KIND, label: "Text", group: "Text", footprint: { width: 1, depth: TEXT_FLAT_DEPTH }, height: 0.3, color: GREY_BOX };

/** The value schema the agent's object.set and object.add carry. */
export const TEXT_VALUE_SCHEMA = Object.freeze({
	type: "object",
	properties: {
		value: { type: "string", minLength: 1, maxLength: MAX_CHARS },
		size: { type: "number", minimum: LIMITS.size[0], maximum: LIMITS.size[1] },
		depth: { type: "number", minimum: LIMITS.depth[0], maximum: LIMITS.depth[1] },
		align: { type: "string", enum: ALIGNS },
	},
	required: [],
	additionalProperties: false,
});

const clampTo = ([min, max], value, fallback) => {
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** The stored text: every field present and repaired. Up to MAX_LINES lines of
 * MAX_CHARS characters in all; blank words fall back to the default. */
export function normalizeText(value) {
	const given = value && typeof value === "object" && !Array.isArray(value) ? value : {};
	const lines = typeof given.value === "string" ? given.value.replace(/\r\n?/g, "\n").split("\n").slice(0, MAX_LINES) : [];
	const words = [...lines.join("\n")].slice(0, MAX_CHARS).join("");
	return {
		value: words.trim() ? words : DEFAULT_TEXT.value,
		size: clampTo(LIMITS.size, given.size, DEFAULT_TEXT.size),
		depth: clampTo(LIMITS.depth, given.depth, DEFAULT_TEXT.depth),
		align: ALIGNS.includes(given.align) ? given.align : DEFAULT_TEXT.align,
	};
}

const isWide = (code) => (code >= 0x1100 && code <= 0x11ff) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7af) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef);

/** One character's advance in sizes. */
function advance(char) {
	const code = char.codePointAt(0);
	if (code >= 32 && code <= 126) return ASCII_ADVANCE[code - 32] / TEXT_FONT.resolution;
	return isWide(code) ? WIDE_ADVANCE : OTHER_ADVANCE;
}

/** True when the bundled typeface draws every character (solid letters). */
export function textIsSolid(text) {
	return text.depth > 0 && [...text.value].every((char) => char === "\n" || (char.codePointAt(0) >= 32 && char.codePointAt(0) <= 126));
}

/**
 * Where each line sits, in metres: `width` of the widest line, `height` from
 * the lowest line's descender to the top line's ascender, and per line its
 * text, its left edge x (the box is centred on x = 0) and its baseline y.
 */
export function textLayout(text) {
	const { size, align } = text;
	const lines = text.value.split("\n");
	const widths = lines.map((line) => [...line].reduce((sum, char) => sum + advance(char), 0) * size);
	const width = Math.max(...widths, size * 0.2);
	const descent = (TEXT_FONT.descent / TEXT_FONT.resolution) * size;
	const height = (lines.length - 1) * TEXT_LINE_PITCH * size + ((TEXT_FONT.ascent + TEXT_FONT.descent) / TEXT_FONT.resolution) * size;
	const rows = lines.map((line, i) => ({
		text: line,
		width: widths[i],
		x: align === "left" ? -width / 2 : align === "right" ? width / 2 - widths[i] : -widths[i] / 2,
		baseline: descent + (lines.length - 1 - i) * TEXT_LINE_PITCH * size,
	}));
	return { width, height, rows };
}

/** The record fields a text carries (none for any other renderer): the
 * repaired words and the box measured from them, which override the entry's. */
export function textFields(record) {
	if (record?.renderer !== TEXT_KIND) return {};
	const text = normalizeText(record.text);
	const { width, height } = textLayout(text);
	const round = (n) => Number(n.toFixed(4));
	return { text, footprint: { width: round(width), depth: round(Math.max(text.depth, TEXT_FLAT_DEPTH)) }, height: round(height), supportY: round(height) };
}

/** An update patch's `text` merged over the record's own and re-measured, or
 * nothing when the record is no text or the words do not change. */
export function textPatch(object, patch) {
	if (object?.renderer !== TEXT_KIND || patch?.text === undefined || !patch.text || typeof patch.text !== "object") return {};
	const fields = textFields({ renderer: TEXT_KIND, text: { ...object.text, ...patch.text } });
	return JSON.stringify(fields.text) === JSON.stringify(object.text) ? {} : fields;
}
