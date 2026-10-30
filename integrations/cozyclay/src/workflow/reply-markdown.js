// The subset of Markdown the agent writes in its replies (headings, bullet and numbered lists, bold, inline code,
// fenced code, pipe tables), read into plain block data so the panel renders it as text instead of showing the
// marks. Anything else stays literal; a half-streamed mark (an unclosed ** or ```) shows as typed until it closes.
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/;
const FENCE = /^\s*```/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`/g;

function spans(text) {
	const out = [];
	let at = 0;
	for (const match of text.matchAll(INLINE)) {
		if (match.index > at) out.push({ text: text.slice(at, match.index) });
		out.push(match[2] === undefined ? { text: match[1], bold: true } : { text: match[2], code: true });
		at = match.index + match[0].length;
	}
	if (at < text.length) out.push({ text: text.slice(at) });
	return out;
}

const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => spans(cell.trim()));

/** Reply text → [{ type: "p"|"h", spans } | { type: "ul"|"ol", start?, items: [spans] } | { type: "code", text } | { type: "table", head, rows }]. */
export function replyBlocks(text) {
	const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
	const blocks = [];
	let open = null;
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (FENCE.test(line) && lines.slice(i + 1).some((next) => FENCE.test(next))) {
			const body = [];
			for (i += 1; !FENCE.test(lines[i]); i += 1) body.push(lines[i]);
			blocks.push({ type: "code", text: body.join("\n") });
			open = null;
			continue;
		}
		if (!line.trim()) { open = null; continue; }
		const heading = HEADING.exec(line);
		if (heading) { blocks.push({ type: "h", raw: heading[1] }); open = null; continue; }
		if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? "")) {
			const table = { type: "table", head: cells(line), rows: [] };
			for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i += 1) table.rows.push(cells(lines[i]));
			i -= 1;
			blocks.push(table);
			open = null;
			continue;
		}
		const item = LIST_ITEM.exec(line);
		if (item) {
			const type = item[1] === undefined ? "ul" : "ol";
			if (open?.type !== type) {
				open = { type, items: [], ...(type === "ol" && item[1] !== "1" ? { start: Number(item[1]) } : {}) };
				blocks.push(open);
			}
			open.items.push(item[2]);
			continue;
		}
		if (open?.type === "p") open.raw += `\n${line}`;
		else if (open) open.items[open.items.length - 1] += ` ${line.trim()}`;
		else blocks.push(open = { type: "p", raw: line });
	}
	return blocks.map(({ raw, items, ...block }) => {
		if (raw !== undefined) return { ...block, spans: spans(raw) };
		if (items) return { ...block, items: items.map(spans) };
		return block;
	});
}
