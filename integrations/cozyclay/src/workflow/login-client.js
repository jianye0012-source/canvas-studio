// The panel's side of pi's provider login (#pi-login, bin/agent/provider-routes.mjs): list the login methods,
// start one, read its prompts and events (long poll), answer a prompt, cancel, log out. The sidecar runs pi's
// own login flow; a typed secret goes to the sidecar once, in the answer body, and is never read back.
import { sidecarRequest } from "../agent-image-client.js";

const request = (path, init) => sidecarRequest(globalThis.fetch.bind(globalThis), path, init);
const flowPath = (flowId) => `/agent/logins/${encodeURIComponent(flowId)}`;

/** [{ id, name, methods: [{ type: oauth|api_key|chatgpt, label, subscription }], connected, via, source }] */
export async function fetchLogins() {
	const result = await request("/agent/logins");
	return Array.isArray(result?.providers) ? result.providers : [];
}

export async function startLogin(providerId, type) {
	return (await request("/agent/logins", { method: "POST", body: JSON.stringify({ providerId, type }) })).flowId;
}

/** { events, next, done } after `after` entries; waits on the sidecar for the next one. */
export async function readLogin(flowId, after) {
	return request(`${flowPath(flowId)}?after=${after}`);
}

export async function answerLogin(flowId, promptId, value) {
	return request(`${flowPath(flowId)}/answer`, { method: "POST", body: JSON.stringify({ promptId, value }) });
}

export async function cancelLogin(flowId) {
	return request(flowPath(flowId), { method: "DELETE" });
}

export async function logoutProvider(providerId) {
	return request(`/agent/logout/${encodeURIComponent(providerId)}`, { method: "POST" });
}
