// ESLint ratchet: fail when the error count of any rule exceeds tools/eslint-baseline.json.
// Usage: node tools/check-eslint.mjs [--update]
//   (no flag)  compare current counts with the baseline; exit 1 on any regression
//   --update   rewrite the baseline with the current counts
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "tools", "eslint-baseline.json");

// Run the package's JS entry through node: the .bin shim is a .cmd on Windows, which spawnSync cannot start without a shell.
const run = spawnSync(process.execPath, [join(root, "node_modules", "eslint", "bin", "eslint.js"), ".", "--format", "json"], {
	cwd: root,
	encoding: "utf8",
	maxBuffer: 512 * 1024 * 1024,
});
// eslint exits 1 when it finds errors; anything else without JSON output is a real failure.
let results;
try {
	results = JSON.parse(run.stdout);
} catch {
	console.error(`eslint did not produce JSON (status ${run.status})\n${run.stderr}`);
	process.exit(2);
}

const counts = {};
const hits = {};
for (const file of results) {
	for (const m of file.messages) {
		if (m.severity !== 2) continue;
		const rule = m.ruleId ?? "fatal";
		counts[rule] = (counts[rule] ?? 0) + 1;
		(hits[rule] ??= []).push(`${relative(root, file.filePath)}:${m.line}: ${m.message}`);
	}
}
const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));

if (process.argv.includes("--update")) {
	writeFileSync(baselinePath, `${JSON.stringify(sorted, null, "\t")}\n`);
	console.log(`eslint: baseline updated (${Object.keys(sorted).length} rules)`);
	process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const regressed = Object.keys(sorted).filter((rule) => sorted[rule] > (baseline[rule] ?? 0));
if (regressed.length) {
	for (const rule of regressed) {
		console.log(`${rule}: ${baseline[rule] ?? 0} -> ${sorted[rule]}`);
	}
	console.log("");
	for (const line of regressed.flatMap((rule) => hits[rule]).slice(0, 10)) console.log(line);
	process.exit(1);
}
const total = Object.values(sorted).reduce((a, b) => a + b, 0);
const base = Object.values(baseline).reduce((a, b) => a + b, 0);
console.log(`eslint: ${total} errors across ${Object.keys(sorted).length} rules (baseline ${base}), 0 regressions`);
