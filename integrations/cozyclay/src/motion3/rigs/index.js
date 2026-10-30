// Bind skeletons of the bodies a take can be compiled for (tools/motion3/extract-rig.mjs).
import xBot from "./x-bot-tpose.json" with { type: "json" };
import yBot from "./y-bot-tpose.json" with { type: "json" };
import { createSkeleton } from "../compiler/skeleton.js";

const RIGS = { "x-bot-tpose": xBot, "y-bot-tpose": yBot };
const cache = new Map();

/** Skeleton for a character model id, or null for a body motion3 cannot drive. */
export function skeletonFor(model) {
	if (!RIGS[model]) return null;
	if (!cache.has(model)) cache.set(model, createSkeleton(RIGS[model]));
	return cache.get(model);
}
