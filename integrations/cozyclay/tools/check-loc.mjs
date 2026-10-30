#!/usr/bin/env node
// Usage: node tools/check-loc.mjs [--update]
// Ratchet pure source LOC; --update rewrites tools/loc-baseline.json.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const baselinePath = join(root, 'tools', 'loc-baseline.json');
const extensions = new Set(['.js', '.jsx', '.mjs']);
const roots = ['src', 'bin', 'mcp', 'tools', 'workers'];

function filesUnder(directory) {
	const files = [];
	for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === 'dist') continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...filesUnder(path));
		else if (entry.isFile() && extensions.has(path.slice(path.lastIndexOf('.')))) files.push(path);
	}
	return files;
}

function pureLoc(path) {
	return readFileSync(join(root, path), 'utf8')
		.split(/\r?\n/)
		.filter((line) => line.trim() && !/^\s*\/\//.test(line)).length;
}

const current = Object.fromEntries(
	roots.flatMap(filesUnder)
		.map((path) => [path.replaceAll('\\', '/'), pureLoc(path)])
		.filter(([, lines]) => lines > 250)
		.sort(([a], [b]) => a.localeCompare(b)),
);

if (process.argv.includes('--update')) {
	writeFileSync(baselinePath, `${JSON.stringify(current, null, '\t')}\n`);
	console.log(`loc: baseline updated (${Object.keys(current).length} files over 250)`);
	process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const violations = [];
for (const [path, lines] of Object.entries(current)) {
	if (!(path in baseline)) violations.push(`new oversized file ${path} (${lines} lines)`);
	else if (lines > baseline[path]) violations.push(`${path} grew ${baseline[path]} -> ${lines}`);
}
for (const message of violations) console.log(message);

const fixed = Object.keys(baseline).filter((path) => !(path in current));
if (fixed.length) console.log(`fixed: ${fixed.length}`);
console.log(`loc: ${Object.keys(current).length} files over 250 (baseline ${Object.keys(baseline).length}), ${violations.length} violations`);
process.exit(violations.length ? 1 : 0);
