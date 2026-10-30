// The Studio conversation's budget at model-call time. A long Studio session kept every tool result, every script the
// agent wrote and every image whole, so each request carried all of them again: a 28-turn session reached 969k
// context tokens a call (median 534k), most of it old receipts (805k chars) and old scripts (607k chars). Applied to
// the provider view only (pi's transform_context, after the per-request context diet): the stored lane and the
// persisted history keep everything. The newest results, calls and images stay whole; older ones shrink to what a
// later call still needs (their ids and opening lines). The results' and images' boundaries move in steps, so the cached prefix holds for
// several calls instead of changing on every one.
const BUDGET = Object.freeze({ keepResults: 10, keepImages: 3, step: 8, bulky: 1200, head: 480, codeHead: 360 });

const STUDIO_CONTEXT = /^<studio-context/;
const ID_PATTERNS = [/"(?:receiptId|receipt)"\s*:\s*"([0-9a-f-]{36})"/g, /\b(spec-[0-9a-f]{12})\b/g, /"code"\s*:\s*"([A-Z_]{4,})"/g];
const IMAGE_STAND_IN = "[An earlier image, left out of this request to save context. Ask for a fresh view if you need it.]";

/** The count of the oldest items to shrink, of n, keeping `keep` whole: whole steps only, so it changes every `step` items. */
const shrinkCount = (n, keep, step) => (n > keep ? Math.floor((n - keep) / step) * step : 0);

/** A tool result's text, shortened to its opening and the ids a later call may name (receipts, spec ids, refusal codes). */
function shortResultText(text) {
	if (text.length <= BUDGET.bulky) return text;
	const ids = [...new Set(ID_PATTERNS.flatMap(pattern => [...text.matchAll(pattern)].map(match => match[1])))].slice(0, 16);
	return `${text.slice(0, BUDGET.head)} … [${text.length - BUDGET.head} more characters left out of this request${ids.length ? `; ids: ${ids.join(", ")}` : ""}]`;
}

/** A script call's code, shortened to its opening: the call stays readable, its full text stays in the stored history. */
function shortCallArguments(args) {
	if (!args || typeof args.code !== "string" || args.code.length <= BUDGET.bulky) return args;
	return { ...args, code: `${args.code.slice(0, BUDGET.codeHead)}\n/* … ${args.code.length - BUDGET.codeHead} more characters of this earlier script left out of this request */` };
}

/** The messages a Studio request sends, with older tool results, script calls and images shortened (new objects only). */
function budgetStudioMessages(messages) {
	const resultAt = [], callAt = [], imageAt = [];
	// An assistant message of the running turn may carry signed thinking next to its calls: only earlier turns' calls shrink.
	const turnStart = messages.findLastIndex(message => message?.role === "user" && Array.isArray(message.content) && message.content.some(part => part?.type === "text" && STUDIO_CONTEXT.test(part.text ?? "")));
	messages.forEach((message, index) => {
		if (message?.role === "toolResult") resultAt.push(index);
		if (message?.role === "assistant" && index < turnStart) (message.content ?? []).forEach((part, j) => { if (part?.type === "toolCall" && typeof part.arguments?.code === "string") callAt.push([index, j]); });
		(Array.isArray(message?.content) ? message.content : []).forEach((part, j) => { if (part?.type === "image") imageAt.push([index, j]); });
	});
	const oldResults = new Set(resultAt.slice(0, shrinkCount(resultAt.length, BUDGET.keepResults, BUDGET.step)));
	// Earlier turns' scripts all shrink: that set changes only when a turn starts, where the prefix moves anyway.
	const oldCalls = new Set(callAt.map(([i, j]) => `${i}:${j}`));
	const oldImages = new Set(imageAt.slice(0, shrinkCount(imageAt.length, BUDGET.keepImages, BUDGET.step)).map(([i, j]) => `${i}:${j}`));
	if (!oldResults.size && !oldCalls.size && !oldImages.size) return messages;
	return messages.map((message, index) => {
		if (!Array.isArray(message?.content)) return message;
		let changed = false;
		const content = message.content.map((part, j) => {
			const key = `${index}:${j}`;
			if (part?.type === "image" && oldImages.has(key)) { changed = true; return { type: "text", text: IMAGE_STAND_IN }; }
			if (part?.type === "text" && oldResults.has(index) && typeof part.text === "string") { const text = shortResultText(part.text); if (text !== part.text) { changed = true; return { ...part, text }; } }
			if (part?.type === "toolCall" && oldCalls.has(key)) { const args = shortCallArguments(part.arguments); if (args !== part.arguments) { changed = true; return { ...part, arguments: args }; } }
			return part;
		});
		return changed ? { ...message, content } : message;
	});
}

// Scripts that name a language unambiguously; Han alone (no kana) reads as Chinese.
const SCRIPTS = [[/[가-힣]/, "Korean"], [/[぀-ヿ]/, "Japanese"], [/[一-鿿]/, "Chinese"], [/[Ѐ-ӿ]/, "Russian"], [/[฀-๿]/, "Thai"], [/[؀-ۿ]/, "Arabic"]];

/** The language the user's message is written in when its script says so, else null (Latin text: no guess). */
function replyLanguage(text) {
	const plain = String(text ?? "").replace(/<studio-context[\s\S]*?(<\/studio-context>|\/>)/g, "");
	return SCRIPTS.find(([pattern]) => pattern.test(plain))?.[1] ?? null;
}

/** The reminder a user's Studio message carries at model-call time. A general "reply in the user's language" rule barely moves
 * replies; drift into English comes in the short notes before tool calls, so the language is named, from the user's own text. */
const languageReminder = language => `[Reply in ${language}. Write every message for this request in ${language}, the language it is written in, short notes before tool calls included, even when tools answer in English.]`;

// A request about staging, coverage or the camera.
const STAGING_WORDS = /샷|컷|카메라|커버리지|구도|배치|동선|OTS|투샷|프레임|shot|camera|coverage|two-shot|framing|staging|blocking/i;

/**
 * Whether a Studio turn carries the top-view plan image. It used to ride every turn of any scene with a shot or two
 * characters, re-sending a plan the conversation already had; now a turn asks for it by wording, or it comes once,
 * on the first turn of such a scene in this session (planSeen: a plan was already attached here).
 */
export const wantsPlan = ({ text, characterCount, shots, planSeen }) => STAGING_WORDS.test(text || "") || (!planSeen && (characterCount >= 2 || shots >= 1));


/**
 * Each Studio prompt message ends with its reply-language reminder (by its own text, so the cached prefix never moves), and a
 * long turn repeats it on every REMIND_EVERY-th tool result after the prompt: 9240db36 wrote a note in English 17 results in.
 */
const REMIND_EVERY = 8;
function withLanguageReminders(messages) {
	let language = null, results = 0;
	return messages.map(message => {
		if (message?.role === "toolResult" && language && Array.isArray(message.content) && ++results % REMIND_EVERY === 0) return { ...message, content: [...message.content, { type: "text", text: languageReminder(language) }] };
		if (message?.role !== "user" || !Array.isArray(message.content) || !message.content.some(part => part?.type === "text" && STUDIO_CONTEXT.test(part.text ?? ""))) return message;
		language = replyLanguage(message.content.filter(part => part?.type === "text").map(part => part.text).join("\n")); results = 0;
		return language ? { ...message, content: [...message.content, { type: "text", text: languageReminder(language) }] } : message;
	});
}

/** The Studio request after the context diet: older bulk shortened, every prompt carrying its reply language. */
export const budgetStudioRequest = ({ messages, systemPrompt }) => ({ messages: withLanguageReminders(budgetStudioMessages(messages)), systemPrompt });
