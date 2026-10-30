import { PROVIDERS } from "./providers.mjs";
import { readCredentials, removeCredential, setCredential } from "./provider-keys.mjs";

const codexId = "openai-codex";
const apiProvider = (id) => PROVIDERS.find((provider) => provider.id === id);

function envValue(provider, env) {
	const name = provider.env.find((name) => typeof env[name] === "string" && env[name].trim());
	return name ? env[name] : undefined;
}

// Share in-process exclusion across stores used by routes and model registries.
// Each gate always resolves; operation failures still propagate to their caller.
const mutations = new Map();
async function serialized(providerId, operation, signal) {
	const previous = mutations.get(providerId);
	let release;
	const gate = new Promise((resolve) => { release = resolve; });
	mutations.set(providerId, gate);
	try {
		await previous;
		signal?.throwIfAborted();
		return await operation();
	} finally {
		release();
		if (mutations.get(providerId) === gate) mutations.delete(providerId);
	}
}

function mapOAuth(raw) {
	if (!raw) return undefined;
	return {
		type: "oauth",
		refresh: raw.refresh_token,
		access: raw.access_token,
		expires: Number(raw.expires_at || 0),
	};
}

function rawOAuth(credential) {
	return {
		access_token: credential.access,
		refresh_token: credential.refresh,
		expires_at: credential.expires,
	};
}

// pi's CredentialStore for every provider pi can log in to (#pi-login): ChatGPT stays in codex-auth's file (its
// id_token carries the plan and account the image routes need), a bare api key in providers.json, and what pi's
// login flows return beyond that (OAuth tokens, api keys with provider env) in auth.json. A credential that
// lands in one file is removed from the other, so one provider never has two.

export function createCredentialStore({ auth, keys, env = process.env, credentialFile = { read: readCredentials, set: setCredential, remove: removeCredential } }) {
	const configured = (id) => apiProvider(id);
	return {
		async read(providerId, { signal } = {}) {
			signal?.throwIfAborted();
			if (providerId === codexId) {
				const stored = typeof auth?.readStored === "function" ? await auth.readStored() : undefined;
				return mapOAuth(stored);
			}
			const provider = configured(providerId);
			const fromEnv = provider && envValue(provider, env);
			if (fromEnv) return { type: "api_key", key: fromEnv };
			const credential = credentialFile.read()[providerId];
			if (credential) return credential;
			const key = keys.readKeys()[providerId];
			return key ? { type: "api_key", key } : undefined;
		},
		async list({ signal } = {}) {
			signal?.throwIfAborted();
			const saved = keys.readKeys();
			const result = [];
			for (const provider of PROVIDERS) {
				if (provider.id === codexId) {
					const stored = typeof auth?.readStored === "function" ? await auth.readStored() : undefined;
					if (stored) result.push({ providerId: provider.id, type: "oauth", source: "chatgpt" });
					continue;
				}
				const source = envValue(provider, env) ? "env" : saved[provider.id] || credentialFile.read()[provider.id] ? "file" : null;
				if (source) result.push({ providerId: provider.id, type: credentialFile.read()[provider.id]?.type ?? "api_key", source });
			}
			// providers outside the curated list that a pi login stored
			const listed = new Set(result.map((entry) => entry.providerId));
			for (const [providerId, credential] of Object.entries({ ...Object.fromEntries(Object.keys(saved).map((id) => [id, { type: "api_key" }])), ...credentialFile.read() })) {
				if (!listed.has(providerId)) result.push({ providerId, type: credential.type, source: "file" });
			}
			return result;
		},
		async modify(providerId, fn, { signal } = {}) {
			return serialized(providerId, async () => {
				const current = await this.read(providerId, { signal });
				const next = await fn(current);
				if (next === undefined) return current;
				if (providerId === codexId) await auth.writeStored(rawOAuth(next));
				else if (next.type === "api_key" && !next.env) {
					keys.setKey(providerId, next.key);
					credentialFile.remove(providerId);
				} else {
					credentialFile.set(providerId, next);
					if (keys.readKeys()[providerId]) keys.removeKey(providerId);
				}
				return next;
			}, signal);
		},
		async delete(providerId, { signal } = {}) {
			await serialized(providerId, async () => {
				if (providerId === codexId) await auth.logout();
				else {
					if (keys.readKeys()[providerId]) keys.removeKey(providerId);
					credentialFile.remove(providerId);
				}
			}, signal);
		},
	};
}
