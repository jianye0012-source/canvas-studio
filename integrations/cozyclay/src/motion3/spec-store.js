// C7. Spec ids and the editor's spec store. specIdOf is final (W0). The store is an LRU of
// SPEC_STORE_SIZE entries (lane D2): put, get, keepParts and parts all count as a use, and the
// least recently used entry goes first. It lives in the editor page's memory: a reload forgets
// it, and the agent then sends the whole spec again (motion3.js answers an unknown base or
// specId with that advice).
// frames: "auto" is an intent the stored spec cannot carry: the spec a specId names (and a take
// keeps) holds the resolved number. The pipeline marks such a spec (markFramesAuto) and the store
// remembers the mark beside the entry, so get() answers frames: "auto" again and base + patch
// re-resolves the length (keys appended past the old end extend it instead of failing).

export const SPEC_STORE_SIZE = 64;
const resolvedFromAuto = new WeakSet();

/** Marks a spec whose numeric frames were resolved from frames: "auto" (pipeline.js); answers it. */
export function markFramesAuto(spec) {
	resolvedFromAuto.add(spec);
	return spec;
}

/** Canonical JSON: object keys sorted at every level (arrays keep their order). */
const canonical = v => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
	: v && typeof v === "object" ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
		: JSON.stringify(v) ?? "null");

/** "spec-" + the first 12 hex digits of the FNV-1a 64-bit hash of the spec's canonical JSON. */
export function specIdOf(spec) {
	let h = 0xcbf29ce484222325n;
	for (const byte of new TextEncoder().encode(canonical(spec))) h = BigInt.asUintN(64, (h ^ BigInt(byte)) * 0x100000001b3n);
	return `spec-${h.toString(16).padStart(16, "0").slice(0, 12)}`;
}

/**
 * The editor's store of compiled specs and their full output parts (C7).
 *   put(spec) -> specId                 remember a compiled spec (the most recent SPEC_STORE_SIZE)
 *   get(specId) -> spec | null          a copy of a remembered spec; frames: "auto" when it was
 *                                       resolved from "auto" (the mark sticks to the specId)
 *   keepParts(specId, parts)            the overflow hook: { groups, timeline, probes } in full,
 *                                       before fitOutput cuts them (report.js)
 *   parts(specId) -> parts | null       what motion.report pages and delta compares against
 */
export function createSpecStore(max = SPEC_STORE_SIZE) {
	const entries = new Map(), size = Math.max(1, max);
	// a Map keeps insertion order: re-inserting moves an entry to the end, the first is the oldest
	const touch = (id, entry) => { entries.delete(id); entries.set(id, entry); while (entries.size > size) entries.delete(entries.keys().next().value); return entry; };
	const seen = id => (entries.has(id) ? touch(id, entries.get(id)) : null);
	return {
		put(spec) {
			const id = specIdOf(spec), was = entries.get(id);
			touch(id, { ...was, spec: structuredClone(spec), framesAuto: resolvedFromAuto.has(spec) || was?.framesAuto === true });
			return id;
		},
		get(id) {
			const entry = seen(id);
			return entry?.spec ? { ...structuredClone(entry.spec), ...(entry.framesAuto ? { frames: "auto" } : {}) } : null;
		},
		keepParts(id, parts) { touch(id, { ...entries.get(id), parts }); },
		parts(id) { return seen(id)?.parts ?? null; },
	};
}
