#!/usr/bin/env node
// The Studio request's budget at model-call time (bin/agent/studio-context-budget.mjs). A 28-turn session reached
// 969k context tokens a call because every old receipt, script and image went back to the model whole, final replies
// to Korean users came back in English 9 times in 36, and the top-view plan image rode every turn of a staged scene.
// Checked here: older results, earlier turns' scripts and older images shrink (ids kept, newest whole, boundaries in
// steps, stored history untouched, the running turn's calls untouched); each prompt carries its reply language; the
// plan comes on a staging request or once per session; a restored transcript never shows an observation label as the
// user's words. Plus one Studio session through the real runner and a scripted model.
import assert from "node:assert/strict";
import { budgetStudioRequest, wantsPlan } from "../bin/agent/studio-context-budget.mjs";
import { createAgentRunner } from "../bin/agent/agent-runner.mjs";
import { transcriptFromHistory } from "../bin/agent/session-store.mjs";
import { encodeStudioContext } from "../src/studio-agent-context.js";
import { createFakeModel } from "./fixtures/fake-model.mjs";
import { contextFixture } from "./verify-studio-agent-protocol.mjs";

let failures = 0;
const check = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (error) { failures += 1; console.log(`FAIL ${name} — ${error.message}`); } };
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const spec = n => `spec-${String(n).padStart(12, "0")}`;
const prompt = text => ({ role: "user", content: [{ type: "text", text: `<studio-context>\n${JSON.stringify({ scene: { name: "운전석 세트" } })}\n</studio-context>` }, { type: "text", text }] });
const call = (i, code) => ({ role: "assistant", content: [{ type: "thinking", thinking: `plan ${i}`, thinkingSignature: `sig-${i}` }, { type: "toolCall", id: `c${i}`, name: "script", arguments: { code } }] });
const result = (i, extra = []) => ({ role: "toolResult", toolCallId: `c${i}`, toolName: "script", isError: false, content: [{ type: "text", text: `{"ok":true,"receipt":"${uuid(i)}","specId":"${spec(i)}","summary":"step ${i}","qa":{"total":${i}},"pad":"${"x".repeat(3000)}"}` }, ...extra] });
const image = i => ({ type: "image", data: `iVBORw0KGgo${i}`, mimeType: "image/png" });
// Two turns: the first with 12 scripted calls, the second (running) with n of its own; every result carries an image.
function history(n) {
	const out = [prompt("의자를 끌어와서 앉아줘")];
	for (let i = 0; i < 12; i++) out.push(call(i, `// earlier turn ${i}\n${"const a = 1;\n".repeat(200)}`), result(i, [image(i)]));
	out.push({ role: "assistant", content: [{ type: "text", text: "done" }] }, prompt("이제 카메라를 레일로 바꿔줘"));
	for (let i = 12; i < 12 + n; i++) out.push(call(i, `// running turn ${i}\n${"const b = 2;\n".repeat(200)}`), result(i, [image(i)]));
	return out;
}
const run = messages => budgetStudioRequest({ messages, systemPrompt: "rules" }).messages;
const text = message => message.content.filter(part => part.type === "text").map(part => part.text).join("\n");

check("older tool results shrink to their opening and ids; the newest stay whole", () => {
	const out = run(history(14)), results = out.filter(m => m.role === "toolResult");
	const whole = results.filter(m => text(m).length > 3000), short = results.filter(m => text(m).length < 1200);
	assert.ok(whole.length >= 10 && whole.length < 18, `${whole.length} whole`);
	assert.equal(whole.length + short.length, results.length);
	for (const m of short) assert.match(text(m), new RegExp(`ids: .*${m.toolCallId === "c0" ? uuid(0) : ""}.*spec-`), text(m).slice(-200));
	assert.ok(short.every(m => text(m).includes("more characters left out of this request")));
});
check("the shrink boundary moves in steps of 8, so most consecutive requests share their prefix", () => {
	let same = 0, total = 0;
	for (let n = 1; n < 30; n++) {
		const a = run(history(n)), b = run(history(n + 1));
		total += 1; if (JSON.stringify(a) === JSON.stringify(b.slice(0, a.length))) same += 1;
	}
	assert.ok(same / total >= 0.7, `${same}/${total} requests kept the previous request as their exact prefix`);
});
check("only earlier turns' scripts shrink; the running turn's calls (next to signed thinking) stay whole", () => {
	const out = run(history(14));
	const calls = out.filter(m => m.role === "assistant" && m.content.some(p => p.type === "toolCall"));
	const earlier = calls.filter(m => m.content[1].arguments.code.startsWith("// earlier")), running = calls.filter(m => m.content[1].arguments.code.startsWith("// running"));
	assert.ok(earlier.some(m => m.content[1].arguments.code.includes("left out of this request")), "earlier scripts shrink");
	assert.ok(running.every(m => m.content[1].arguments.code.length > 2000), "running-turn scripts stay whole");
	assert.ok(calls.every(m => m.content[0].type === "thinking" && m.content[0].thinkingSignature), "thinking blocks are kept as they are");
});
check("older images become a short text stand-in; the newest few stay images", () => {
	const out = run(history(14)), parts = out.flatMap(m => m.content ?? []);
	const images = parts.filter(p => p.type === "image").length, standIns = parts.filter(p => p.type === "text" && p.text.startsWith("[An earlier image")).length;
	assert.ok(images >= 3 && images < 11, `${images} images kept`);
	assert.equal(images + standIns, 26);
});
check("the stored history is never edited", () => {
	const h = history(14), before = JSON.stringify(h);
	run(h);
	assert.equal(JSON.stringify(h), before);
});
check("a short history passes through as the same array", () => {
	const h = [prompt("hello"), call(0, "x"), result(0)];
	assert.equal(budgetStudioRequest({ messages: h, systemPrompt: "" }).messages.length, 3);
});
check("each Studio prompt ends with its reply-language reminder; English text and Korean scene names get none", () => {
	const out = run([prompt("의자를 끌어와서 앉아줘"), { role: "assistant", content: [{ type: "text", text: "ok" }] }, prompt("now pull the chair")]);
	assert.match(out[0].content.at(-1).text, /^\[Reply in Korean\. /);
	assert.equal(out[2].content.at(-1).text, "now pull the chair", "an English message carries no reminder, though its scene name is Korean");
	assert.match(run([prompt("椅子に座って")])[0].content.at(-1).text, /^\[Reply in Japanese\. /);
});
check("a long turn repeats the reply language on every 8th tool result, at fixed places", () => {
	const out = run(history(17)), turn = out.slice(out.findLastIndex(m => m.role === "user")).filter(m => m.role === "toolResult");
	const reminded = turn.map((m, i) => /^\[Reply in Korean\. /.test(m.content.at(-1).text ?? "") ? i + 1 : 0).filter(Boolean);
	assert.deepEqual(reminded, [8, 16], "9240db36 wrote an English note 17 results into a Korean turn");
	assert.deepEqual(run(history(18)).slice(0, out.length - 2).map(text), out.slice(0, out.length - 2).map(text), "the reminders stay where they were as the turn grows");
});
check("the plan comes on a staging request, or once on a staged scene's first turn", () => {
	assert.equal(wantsPlan({ text: "의자에 앉아줘", characterCount: 2, shots: 1, planSeen: false }), true, "first turn of a staged scene");
	assert.equal(wantsPlan({ text: "의자에 앉아줘", characterCount: 2, shots: 1, planSeen: true }), false, "not again on a plain turn");
	assert.equal(wantsPlan({ text: "카메라 각도 바꿔줘", characterCount: 1, shots: 1, planSeen: true }), true, "a camera request always");
	assert.equal(wantsPlan({ text: "walk 3 m", characterCount: 1, shots: 0, planSeen: false }), false, "an unstaged scene never");
});
check("a restored transcript shows an observation's image, never its label as the user's words", () => {
	const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
	for (const label of ["Studio plan observation (top view) revision 41 receipt unavailable", "Studio plan observation (top view) at scene revision 41", "Studio frame observation at scene revision 7, receipt r-1"]) {
		const transcript = transcriptFromHistory([{ role: "user", content: [{ type: "text", text: label }, { type: "image", data: png, mimeType: "image/png" }] }]);
		assert.ok(transcript.every(entry => !String(entry.text ?? "").includes("observation")), JSON.stringify(transcript).slice(0, 200));
	}
});

// The real runner: a Korean Studio prompt and a scripted model calling a bulky tool 13 times in one turn.
const fake = createFakeModel();
fake.script([...Array.from({ length: 13 }, (_, i) => [{ type: "toolCall", id: `t${i}`, name: "script", arguments: { code: `return ${i};` } }]), [{ type: "text", text: "완료" }]]);
const stored = [];
const tools = [{ name: "script", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false },
	handler: async ({ code }) => ({ ok: true, receipt: uuid(Number(code.match(/\d+/)[0])), specId: spec(Number(code.match(/\d+/)[0])), pad: "y".repeat(2500) }) }];
const runner = createAgentRunner({ models: fake.models, fauxProvider: fake.fauxProvider, sessionStore: { read: () => null, append: async (_id, messages) => { stored.push(...messages); } } });
const session = await runner.openSession("context-trim", { surface: "studio" });
const frames = [];
for await (const frame of session.start({ surface: "studio", model: "faux/scripted", text: "의자 끌어오는 장면 만들어줘", contextText: encodeStudioContext(contextFixture()), tools })) frames.push(frame);
await runner.close();
check("through the runner: the turn ends with done, and the last request keeps 10 to 17 results whole, the rest shrunk with their ids", () => {
	assert.equal(frames.at(-1)?.type, "done");
	const results = fake.calls.at(-1).messages.filter(m => m.role === "toolResult");
	const short = results.filter(m => text(m).includes("left out of this request"));
	assert.equal(results.length, 13);
	assert.ok(short.length >= 0 && results.length - short.length >= 10, `${short.length} shrunk`);
	assert.ok(short.every(m => text(m).includes("spec-")));
});
check("through the runner: the Korean prompt reaches the model with its language reminder", () => {
	const user = fake.calls.at(-1).messages.find(m => m.role === "user");
	assert.match(user.content.at(-1).text, /^\[Reply in Korean\. /);
	assert.ok(stored.filter(m => m.role === "user").every(m => !JSON.stringify(m).includes("Reply in ")), "the stored prompt has no reminder");
});

if (failures) { console.error(`${failures} context trim check(s) failed`); process.exit(1); }
console.log("agent context trim: all checks passed");
