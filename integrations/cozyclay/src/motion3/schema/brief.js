// A JSON Schema fragment (describe.js) -> one short type line, for motion.describe
// { topic: "essentials" }: `{f: int, set: object, step?: string[]}`. `?` marks an optional
// field, `=v` a default, `lo..hi` a range, `A | B` a choice, `[key]: T` a map, `a_l|r` a field
// that has a twin with the same type, `a|b?: T` optional fields with the same schema; a $ref to a
// shared shape keeps its name (vec3, key, ...). With { means: true } each field also says what it
// means, `hand_l|r?: vec3 (the WRIST target in world metres)`, from the schema's description.

const BARE = { integer: "int", number: "number", string: "string", boolean: "bool" };
/** Descriptions that say only the unit: the essentials notes give the units once. */
const UNIT_ONLY = /^(degrees|m)$/;
const range = s => (s.minimum !== undefined && s.maximum !== undefined ? ` ${s.minimum}..${s.maximum}` : "");
/** A literal: strings in single quotes, so the JSON answer needs no escapes. */
const lit = v => (typeof v === "string" ? `'${v}'` : JSON.stringify(v));
const dflt = s => (s.default !== undefined ? `=${lit(s.default)}` : "");
const wrap = t => (/[ |]/.test(t) && !/^[{[].*[}\]]$/.test(t) ? `(${t})` : t);
/** The key name of a map from its description: "scene object or group id -> hinge or carry" -> "scene object or group id". */
const keyOf = s => s.description?.match(/^(?:[^:]*: )?(.+?) -> /)?.[1] ?? "name";

/** A value as a JS literal with single-quoted strings: an example inside a JSON string needs no escapes. */
export function literal(v) {
	if (Array.isArray(v)) return `[${v.map(literal).join(", ")}]`;
	if (v && typeof v === "object") return `{${Object.entries(v).map(([k, x]) => `${k}: ${literal(x)}`).join(", ")}}`;
	return lit(v);
}

/** The tail a description shares with an earlier one in the same line, from a word after ", " or ": ". */
function sharedTail(d, earlier) {
	let i = 0;
	while (i < d.length && i < earlier.length && d[d.length - 1 - i] === earlier[earlier.length - 1 - i]) i += 1;
	const tail = d.slice(d.length - i), cut = tail.search(/[,:] \S/);
	return cut < 0 || tail.length - cut < 40 ? "" : tail.slice(cut + 2);
}

/** The fields of an object schema: `{ a: T, b?: T }`, a map `{ [key]: T }`, or both. */
function objectLine(s, opts) {
	const req = new Set(s.required ?? []), props = Object.entries(s.properties ?? {});
	if (opts.depth === 0) return "object";
	const inner = { ...opts, depth: opts.depth === undefined ? undefined : opts.depth - 1, seen: undefined };
	// a long table of optional numbers with defaults (checks.limits): the names only
	if (props.length > 8 && !req.size && props.every(([, v]) => v.type === "number" && v.default !== undefined)) return `{ [${props.map(([k]) => k).join("|")}]: number }`;
	const twinned = new Set(props.map(([, v]) => v.$ref?.match(/^#\/properties\/(.+)$/)?.[1]).filter(Boolean));
	const said = [];
	/** "(meaning)" once: a meaning that ends like an earlier field's says "as <that field>" instead of the tail;
	 * a field a sibling choice already explained (`opts.seen`, a switch's visible after a carry's) says nothing. */
	const mean = (name, d) => {
		if (opts.seen?.has(`${name}\0${d}`)) return "";
		opts.seen?.add(`${name}\0${d}`);
		for (const [n, e] of said) { const tail = sharedTail(d, e); if (tail) return ` (${d.slice(0, -tail.length - 2)}, as ${n})`; }
		said.push([name, d]);
		return ` (${d})`;
	};
	const typed = (name, v, t = briefType(v, inner)) => t + (opts.means && v.description && !UNIT_ONLY.test(v.description) && !t.includes(v.description) ? mean(name, v.description) : "");
	// optional fields that read the same share one entry: `pitch|spine_pitch?: T`
	const groups = new Map();
	for (const [k, v] of props.filter(([, v]) => !v.$ref?.startsWith("#/properties/"))) {
		const name = twinned.has(k) ? k.replace(/_l$/, "_l|r") : k, t = typed(name, v), same = req.has(k) ? `${k}\0` : t;
		groups.set(same, { names: [...(groups.get(same)?.names ?? []), name], t, req: req.has(k) });
	}
	const fields = [...groups.values()].map(g => `${g.names.join("|")}${g.req ? "" : "?"}: ${g.t}`);
	for (const [p, v] of Object.entries(s.patternProperties ?? {})) fields.push(`/${p}/: ${typed(p, v)}`);
	const extra = s.additionalProperties && typeof s.additionalProperties === "object" ? s.additionalProperties : null;
	if (extra) fields.push(`[${s.propertyNames?.enum?.join("|") ?? keyOf(s)}]: ${typed("", extra)}`);
	return fields.length ? `{${fields.join(", ")}}` : `object${s.description ? ` (${s.description})` : ""}`;
}

/** schema -> type line; opts.means adds each field's meaning, opts.depth stops at that many object levels ("object"). */
export function briefType(s, opts = {}) {
	if (!s || typeof s !== "object") return "any";
	const title = s.title ? `${s.title} ` : "", brief = x => briefType(x, opts);
	if (s.$ref) return s.$ref.split("/").pop() + dflt(s);
	if ("const" in s) return lit(s.const);
	if (s.enum) return s.enum.map(lit).join("|") + dflt(s);
	if (s.oneOf) {
		const shapes = s.oneOf.filter(o => !(Object.keys(o).length === 1 && o.required)), picks = s.oneOf.flatMap(o => (shapes.includes(o) ? [] : o.required));
		const own = s.type === "object" || s.properties ? objectLine(s, opts) : "";
		// the choices share what they explained: a field that reads the same in an earlier choice says nothing more
		const seen = new Set(), choice = shapes.length && shapes.every(o => o.pattern && !o.type) ? `string: ${shapes.map(o => o.description ?? o.pattern).join("; ")}`
			: shapes.map(x => briefType(x, { ...opts, seen })).join(" | ");
		return [title + own, choice, picks.length ? `(one of ${picks.join("|")})` : ""].filter(Boolean).join(" ") + (own ? "" : dflt(s));
	}
	if (s.type === "array") {
		if (!s.items && !s.prefixItems) return `array${s.description ? ` (${s.description})` : ""}`;
		if (s.prefixItems) return `[${s.prefixItems.map(brief).join(", ")}]`;
		const n = s.minItems === s.maxItems && s.maxItems ? ` (${s.maxItems})` : s.maxItems ? ` (<= ${s.maxItems})` : "";
		return `${wrap(brief(s.items))}[]${n}`;
	}
	if (s.type === "object" || s.properties) return title + objectLine(s, opts);
	return (BARE[s.type] ?? "any") + range(s) + dflt(s);
}
