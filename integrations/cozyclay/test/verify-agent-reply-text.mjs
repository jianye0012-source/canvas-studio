#!/usr/bin/env node
// The agent's reply renders its Markdown instead of showing the marks (src/workflow/reply-markdown.js): headings,
// lists, bold, inline and fenced code, pipe tables; a half-streamed mark stays literal until it closes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { replyBlocks } from "../src/workflow/reply-markdown.js";

test("a typical reply: heading, paragraph with bold and code, bullets, numbered list, table", () => {
	const reply = [
		"## 결과",
		"손을 **안쪽 끝까지** 흔들 때 `48f` 근처에서",
		"얼굴 옆까지 들어옵니다.",
		"",
		"- QA 0",
		"- goals 3/3",
		"",
		"3. 첫째",
		"4. 둘째",
		"",
		"| shot | frames |",
		"|---|---:|",
		"| Shot 1 | 0–119 |",
		"| Shot 2 | 120–239 |",
	].join("\n");
	assert.deepEqual(replyBlocks(reply), [
		{ type: "h", spans: [{ text: "결과" }] },
		{ type: "p", spans: [{ text: "손을 " }, { text: "안쪽 끝까지", bold: true }, { text: " 흔들 때 " }, { text: "48f", code: true }, { text: " 근처에서\n얼굴 옆까지 들어옵니다." }] },
		{ type: "ul", items: [[{ text: "QA 0" }], [{ text: "goals 3/3" }]] },
		{ type: "ol", start: 3, items: [[{ text: "첫째" }], [{ text: "둘째" }]] },
		{ type: "table", head: [[{ text: "shot" }], [{ text: "frames" }]], rows: [[[{ text: "Shot 1" }], [{ text: "0–119" }]], [[{ text: "Shot 2" }], [{ text: "120–239" }]]] },
	]);
});

test("fenced code keeps its lines; an unclosed fence or bold mark stays literal while it streams", () => {
	assert.deepEqual(replyBlocks("Run:\n```js\nconst a = 1;\n  b();\n```\nDone."), [
		{ type: "p", spans: [{ text: "Run:" }] },
		{ type: "code", text: "const a = 1;\n  b();" },
		{ type: "p", spans: [{ text: "Done." }] },
	]);
	assert.deepEqual(replyBlocks("Run:\n```js\nconst a"), [{ type: "p", spans: [{ text: "Run:\n```js\nconst a" }] }]);
	assert.deepEqual(replyBlocks("**참고"), [{ type: "p", spans: [{ text: "**참고" }] }]);
});

test("a wrapped list line joins its item; a list starting at 1 has no start; empty text has no blocks", () => {
	assert.deepEqual(replyBlocks("1. one\n   still one\n2. two"), [{ type: "ol", items: [[{ text: "one still one" }], [{ text: "two" }]] }]);
	assert.deepEqual(replyBlocks(""), []);
	assert.deepEqual(replyBlocks(undefined), []);
	assert.deepEqual(replyBlocks("a | b"), [{ type: "p", spans: [{ text: "a | b" }] }], "a pipe without a table rule is text");
});
