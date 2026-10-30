#!/usr/bin/env node
// Usage: node tools/check-knip.mjs [--update]
// Ratchet for knip: fails (exit 1) on findings that are not in tools/knip-baseline.json.
// --update rewrites the baseline with the current findings and exits 0.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'tools', 'knip-baseline.json');

// knip exits 1 when it finds issues; only a missing/unparseable report is a failure.
// Run the package's JS entry through node: the .bin shim is a .cmd on Windows, which spawnSync cannot start without a shell.
const run = spawnSync(process.execPath, [join(root, 'node_modules', 'knip', 'bin', 'knip.js'), '--reporter', 'json', '--no-progress'], {
	cwd: root,
	encoding: 'utf8',
	maxBuffer: 256 * 1024 * 1024,
});
if (run.error) {
	console.error(`knip failed to start: ${run.error.message}`);
	process.exit(2);
}
let report;
try {
	report = JSON.parse(run.stdout);
} catch {
	console.error(`knip produced no JSON (exit ${run.status})\n${run.stderr}`);
	process.exit(2);
}

const keys = new Set();
for (const issue of report.issues ?? []) {
	const file = issue.file;
	if (issue.files === true || (Array.isArray(issue.files) && issue.files.length)) keys.add(`file ${file}`);
	for (const e of issue.exports ?? []) keys.add(`export ${file}#${e.name}`);
	for (const e of issue.types ?? []) keys.add(`export ${file}#${e.name}`);
	for (const e of issue.enumMembers ?? []) keys.add(`export ${file}#${e.name}`);
	for (const e of issue.dependencies ?? []) keys.add(`dependency ${file}#${e.name}`);
	for (const e of issue.devDependencies ?? []) keys.add(`dependency ${file}#${e.name}`);
	for (const e of issue.unlisted ?? []) keys.add(`unlisted ${file}#${e.name}`);
}
for (const f of report.files ?? []) keys.add(`file ${f}`);
const current = [...keys].sort();

if (process.argv.includes('--update')) {
	writeFileSync(baselinePath, `${JSON.stringify(current, null, '\t')}\n`);
	console.log(`knip: baseline updated, ${current.length} findings`);
	process.exit(0);
}

const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : [];
const known = new Set(baseline);
const now = new Set(current);
const added = current.filter((k) => !known.has(k));
const fixed = baseline.filter((k) => !now.has(k));

for (const k of added) console.log(`new: ${k}`);
if (fixed.length) console.log(`fixed: ${fixed.length}`);
console.log(`knip: ${current.length} findings, ${added.length} new, ${fixed.length} fixed (baseline ${baseline.length})`);
process.exit(added.length ? 1 : 0);
