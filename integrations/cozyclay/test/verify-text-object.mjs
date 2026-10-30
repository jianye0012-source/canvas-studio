#!/usr/bin/env node
// A text record: words in one object (a sign, a logo on a truck's side), sized by
// the words themselves. Session 9240db36 built "CozyClay" from 76 thin cubes
// because there was no such object; the agent now writes it with one object.add.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { objectsFixture } from "./bus/objects-fixture.mjs";
import { OBJECT_MENU_ENTRIES, createSceneObject, loadScene, normalizeSceneObject, objectPatchFields, serializeScene, updateSceneObject } from "../src/scene-objects.js";
import { TEXT_FONT, TEXT_FLAT_DEPTH, TEXT_LINE_PITCH, normalizeText, textIsSolid, textLayout } from "../src/text/text-record.js";
import { elementByPath } from "../src/studio-elements.js";
import { STUDIO_PATCH_SET_SCHEMAS } from "../src/studio-agent-protocol.js";

let failures = 0;
async function check(name, fn) {
	try {
		await fn();
		console.log(`PASS ${name}`);
	} catch (error) {
		failures += 1;
		console.log(`FAIL ${name} - ${error.stack?.split("\n").slice(0, 3).join(" | ") ?? error.message}`);
	}
}
const ok = (receipt) => {
	assert.equal(receipt.ok, true, JSON.stringify(receipt));
	return receipt;
};
const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;
const font = JSON.parse(readFileSync(new URL("../src/text/fonts/helvetiker-bold.typeface.json", import.meta.url), "utf8"));
const advance = (words) => [...words].reduce((sum, char) => sum + font.glyphs[char].ha, 0) / font.resolution;

await check("the measured box uses the bundled typeface's own advances and extent", () => {
	assert.equal(TEXT_FONT.resolution, font.resolution);
	for (let code = 32; code <= 126; code += 1) {
		const char = String.fromCharCode(code);
		assert.ok(near(textLayout(normalizeText({ value: `x${char}x`, size: 1 })).width, advance(`x${char}x`)), `advance of ${JSON.stringify(char)}`);
	}
	// every y of every ASCII outline (commands m x y, l x y, q cx cy x y, b c1x c1y c2x c2y x y)
	const ys = [];
	for (let code = 32; code <= 126; code += 1) {
		const parts = (font.glyphs[String.fromCharCode(code)].o ?? "").trim().split(/\s+/);
		for (let i = 0; i < parts.length;) {
			const count = { m: 2, l: 2, q: 4, b: 6 }[parts[i++]] ?? 0;
			for (let k = 1; k < count; k += 2) ys.push(Number(parts[i + k]));
			i += count;
		}
	}
	assert.equal(Math.max(...ys), TEXT_FONT.ascent);
	assert.equal(-Math.min(...ys), TEXT_FONT.descent);
});

await check("a text is creatable, and its box is measured from the words", () => {
	const text = createSceneObject("text", [], { x: 1, z: 2 }, { value: "CozyClay", size: 0.4 });
	assert.equal(text.renderer, "text");
	assert.deepEqual(text.text, { value: "CozyClay", size: 0.4, depth: 0, align: "center" });
	assert.ok(near(text.footprint.width, advance("CozyClay") * 0.4), `${text.footprint.width}`);
	assert.equal(text.footprint.depth, TEXT_FLAT_DEPTH);
	assert.ok(near(text.height, ((TEXT_FONT.ascent + TEXT_FONT.descent) / TEXT_FONT.resolution) * 0.4));
	assert.ok(OBJECT_MENU_ENTRIES.some((entry) => entry.kind === "text"), "the create menu and the agent's catalogue list it");
	assert.ok(elementByPath("object.renderer").enum.includes("text"));
	assert.ok(objectPatchFields(text).includes("text"));
	const plain = createSceneObject("text", [text]);
	assert.equal(plain.text.value, "Text");
	assert.equal(plain.id, "text-2");
});

await check("the words are repaired: clamps, lines, blanks and unknown fields", () => {
	assert.deepEqual(normalizeText({ value: "  ", size: 99, depth: -1, align: "up", extra: 1 }), { value: "Text", size: 10, depth: 0, align: "center" });
	assert.equal(normalizeText({ value: "a\r\nb" }).value, "a\nb");
	assert.equal(normalizeText({ value: "x".repeat(300) }).value.length, 200);
	assert.equal(normalizeText({ value: Array.from({ length: 12 }, (_, i) => `l${i}`).join("\n") }).value.split("\n").length, 8);
	const two = textLayout(normalizeText({ value: "AB\nA", size: 1, align: "left" }));
	assert.ok(near(two.height, TEXT_LINE_PITCH + (TEXT_FONT.ascent + TEXT_FONT.descent) / TEXT_FONT.resolution));
	assert.ok(two.rows[0].baseline > two.rows[1].baseline, "the first line is on top");
	assert.ok(near(two.rows[0].x, -two.width / 2) && near(two.rows[1].x, -two.width / 2), "left aligned lines share the left edge");
	const right = textLayout(normalizeText({ value: "AB\nA", size: 1, align: "right" }));
	assert.ok(near(right.rows[1].x + right.rows[1].width, right.width / 2));
	// Hangul has no solid glyphs in the bundled typeface: it stays flat, with a box all the same
	const korean = createSceneObject("text", [], {}, { value: "코지클레이", size: 0.5, depth: 0.05 });
	assert.ok(korean.footprint.width > 2, `${korean.footprint.width}`);
	assert.equal(textIsSolid(korean.text), false);
	assert.equal(textIsSolid(normalizeText({ value: "CozyClay!", depth: 0.05 })), true);
	assert.equal(textIsSolid(normalizeText({ value: "CozyClay!", depth: 0 })), false);
});

await check("a text survives the scene document round trip and re-measures on update", () => {
	const text = { ...createSceneObject("text", [], {}, { value: "Hello", size: 0.3, depth: 0.04 }), y: 1.2, rot: 90 };
	const loaded = loadScene(serializeScene([text]));
	assert.equal(loaded.dropped, 0);
	assert.deepEqual(loaded.objects[0], normalizeSceneObject(text));
	assert.deepEqual(loaded.objects[0].text, text.text);
	// a stale stored box is not a fact: it is measured again
	assert.deepEqual(normalizeSceneObject({ ...text, footprint: { width: 9, depth: 9 }, height: 9 }).footprint, text.footprint);
	const [longer] = updateSceneObject([text], text.id, { text: { value: "Hello there" } });
	assert.equal(longer.text.value, "Hello there");
	assert.equal(longer.text.size, 0.3, "fields the patch leaves out are kept");
	assert.ok(longer.footprint.width > text.footprint.width);
	assert.equal(longer.footprint.depth, 0.04);
	assert.equal(updateSceneObject([text], text.id, { text: { value: "Hello" } })[0], text, "the same words change nothing");
});

await check("the agent writes words with one object.add, and edits them with object.set (one undo each)", () => {
	const f = objectsFixture([]);
	try {
		const receipt = ok(f.run("object.add", { kind: "text", name: "Logo", text: { value: "CozyClay", size: 0.5 }, placement: { x: 1.2, y: 1.4, z: -2, rot: 90 } }, "agent"));
		const id = receipt.affectedIds[0];
		const row = f.objects.read().find((entry) => entry.id === id);
		assert.equal(row.renderer, "text");
		assert.equal(row.text.value, "CozyClay");
		assert.ok(near(row.x, 1.2) && near(row.y, 1.4) && near(row.z, -2) && near(row.rot, 90));
		assert.ok(near(row.footprint.width, advance("CozyClay") * 0.5));
		const set = ok(f.run("object.set", { ops: [{ id, set: { text: { value: "CozyClay 3", depth: 0.05 } } }] }, "agent"));
		const after = f.objects.read().find((entry) => entry.id === id);
		assert.equal(after.text.value, "CozyClay 3");
		assert.equal(after.text.size, 0.5);
		assert.ok(after.footprint.width > row.footprint.width);
		assert.equal(after.footprint.depth, 0.05);
		assert.equal(f.run("edit.undo", { receiptId: set.receiptId }).status, "undone");
		assert.deepEqual(f.objects.read().find((entry) => entry.id === id).text, row.text);
		const bad = f.run("object.set", { ops: [{ id, set: { text: { value: "x", size: 50 } } }] }, "agent");
		assert.equal(bad.ok, false, "a size past the schema is refused, not clamped silently");
	} finally {
		f.dispose();
	}
});

await check("the agent's set schema carries object.text", () => {
	const schema = STUDIO_PATCH_SET_SCHEMAS.object.properties.text;
	assert.deepEqual(Object.keys(schema.properties).sort(), ["align", "depth", "size", "value"]);
	assert.match(elementByPath("object.text").note, /object\.add \{ kind: "text"/);
});

if (failures > 0) {
	console.log(`${failures} check(s) failed`);
	process.exit(1);
}
console.log("text object contract: ok");
