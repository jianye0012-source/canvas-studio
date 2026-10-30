import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeSecureJson } from "./secure-file.mjs";

function configDir() {
	return process.env.COZYCLAY_CONFIG_DIR
		|| join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "cozyclay");
}

function filePath() {
	return join(configDir(), "providers.json");
}

export function readKeys() {
	const path = filePath();
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		if (error?.code === "ENOENT") return {};
		throw error;
	}
	let value;
	try {
		value = JSON.parse(raw);
	} catch {
		console.warn(`[agent] providers.json is not valid JSON; ignoring it: ${path}`);
		return {};
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		console.warn(`[agent] providers.json is not valid JSON; ignoring it: ${path}`);
		return {};
	}
	for (const [key, entry] of Object.entries(value)) {
		if (key.length === 0 || typeof entry !== "string" || entry.length === 0) {
			console.warn(`[agent] providers.json has an invalid entry; ignoring it: ${path}`);
			return {};
		}
	}
	return value;
}

export function setKey(id, key) {
	const next = { ...readKeys(), [id]: key };
	writeSecureJson(filePath(), next);
	return next;
}

export function removeKey(id) {
	const next = readKeys();
	delete next[id];
	writeSecureJson(filePath(), next);
	return next;
}

// Credentials pi's login flows return that are more than a bare key (#pi-login): OAuth tokens (Claude Pro/Max,
// GitHub Copilot, xAI, Kimi, OpenRouter) and api-key credentials that carry provider env (CLIProxyAPI's server
// address). They are kept as pi's canonical Credential, one per provider id, in auth.json beside providers.json;
// a bare api key stays in providers.json as before. credential-store.mjs decides which file a write goes to.
function authPath() {
	return join(configDir(), "auth.json");
}

/** { [providerId]: Credential } from auth.json; a missing or unreadable file is {}. */
export function readCredentials() {
	if (process.env.CANVAS_LOCAL_PROVIDER_BASE) return { 'openai-compatible': { type: 'api_key', key: process.env.CANVAS_LOCAL_PROVIDER_TOKEN, env: { OPENAI_COMPATIBLE_BASE_URL: process.env.CANVAS_LOCAL_PROVIDER_BASE } } };
	try {
		const value = JSON.parse(readFileSync(authPath(), "utf8"));
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		return Object.fromEntries(Object.entries(value).filter(([id, entry]) => id && entry && typeof entry === "object" && ["api_key", "oauth"].includes(entry.type)));
	} catch {
		return {};
	}
}

export function setCredential(id, credential) {
	const next = { ...readCredentials(), [id]: credential };
	writeSecureJson(authPath(), next);
	return next;
}

export function removeCredential(id) {
	const current = readCredentials();
	if (!(id in current)) return current;
	delete current[id];
	writeSecureJson(authPath(), current);
	return current;
}
