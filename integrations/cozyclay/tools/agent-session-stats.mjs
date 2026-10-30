#!/usr/bin/env node
// Per-turn cost of a Studio agent session: model calls, tokens, refusals and motion calls,
// read from a session JSONL (~/.config/cozyclay/agent-sessions/<id>.jsonl).
//
// node tools/agent-session-stats.mjs <session.jsonl> [--json]
import { readFileSync } from "node:fs";

const [path, flag] = process.argv.slice(2);
if (!path) {
	console.error("usage: node tools/agent-session-stats.mjs <session.jsonl> [--json]");
	process.exit(2);
}

const lines = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
const textOf = content => (Array.isArray(content) ? content : []).map(part => part.text ?? "").join("");
const count = (text, pattern) => (text.match(pattern) ?? []).length;
const MOTION_CALL = /motion\.(compile|describe|qa|sample|report)/g;

const turns = [];
let turn = null;
for (const line of lines) {
	if (line.kind !== "message") {
		if (turn && line.kind === "turn_error") turn.errors.push(line.code ?? "error");
		continue;
	}
	const m = line.message;
	if (m.role === "user") {
		turn = { request: textOf(m.content).split("</studio-context>").pop().trim(), calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0,
			invalid: 0, stale: 0, toolErrors: 0, scripts: 0, motion: {}, first: null, last: null, finished: false, errors: [] };
		turns.push(turn);
		continue;
	}
	if (!turn) continue;
	if (Number.isFinite(m.timestamp)) { turn.first ??= m.timestamp; turn.last = m.timestamp; }
	if (m.role === "assistant") {
		turn.calls++;
		turn.input += m.usage?.input ?? 0; turn.cacheRead += m.usage?.cacheRead ?? 0; turn.cacheWrite += m.usage?.cacheWrite ?? 0; turn.output += m.usage?.output ?? 0;
		if (m.stopReason === "stop") turn.finished = true;
		for (const call of (m.content ?? []).filter(part => part.type === "toolCall")) {
			if (call.name === "script") turn.scripts++;
			const args = JSON.stringify(call.arguments ?? {});
			for (const [, name] of args.matchAll(MOTION_CALL)) turn.motion[name] = (turn.motion[name] ?? 0) + 1;
		}
	} else if (m.role === "toolResult") {
		const text = textOf(m.content);
		if (m.isError) turn.toolErrors++;
		turn.invalid += count(text, /INVALID_ARGUMENT:/g);
		turn.stale += count(text, /STALE_SCENE/g);
	}
}

const rows = turns.map(t => ({ request: t.request.slice(0, 60), calls: t.calls, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, output: t.output,
	invalid: t.invalid, stale: t.stale, toolErrors: t.toolErrors, scripts: t.scripts, motion: t.motion,
	minutes: t.first && t.last ? Math.round((t.last - t.first) / 600) / 100 : null, finished: t.finished, errors: t.errors }));

if (flag === "--json") console.log(JSON.stringify(rows, null, 2));
else for (const r of rows) {
	console.log(`- ${r.request}`);
	console.log(`  calls ${r.calls} · cacheRead ${r.cacheRead.toLocaleString("en")} · cacheWrite ${r.cacheWrite.toLocaleString("en")} · output ${r.output.toLocaleString("en")} · minutes ${r.minutes ?? "?"}`);
	console.log(`  INVALID_ARGUMENT ${r.invalid} · STALE_SCENE ${r.stale} · tool errors ${r.toolErrors} · scripts ${r.scripts} · motion ${JSON.stringify(r.motion)} · finished ${r.finished}${r.errors.length ? ` · turn errors ${r.errors.join(",")}` : ""}`);
}
