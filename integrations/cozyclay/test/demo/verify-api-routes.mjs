#!/usr/bin/env node
// The API Worker after the v3 removals: sign-in and /me remain; the hosted video-model
// routes (/v1/motion/*) and the Kimodo queue are gone and answer 404.
import assert from "node:assert/strict";
import api from "../../workers/api/src/index.js";

const env = { ENVIRONMENT: "development", SITE_ORIGIN: "http://127.0.0.1:5180", API_ORIGIN: "http://127.0.0.1:8787" };
const call = (path, init = {}) => api.fetch(new Request(`http://127.0.0.1:8787${path}`, { headers: { origin: env.SITE_ORIGIN, "content-type": "application/json" }, ...init }), env);
for (const [path, init] of [["/v1/motion/me"], ["/v1/motion/act", { method: "POST", body: "{}" }], ["/v1/motion/jobs/abc"], ["/jobs"], ["/r/abc.npz"]]) {
	const response = await call(path, init);
	assert.equal(response.status, 404, `${path} is gone`);
}
const preflight = await call("/me", { method: "OPTIONS" });
assert.equal(preflight.status, 204);
assert.equal(typeof api.scheduled, "function", "the OAuth-state cleanup still runs on the cron");
console.log("PASS api worker: sign-in routes remain, video-model and queue routes are gone");
