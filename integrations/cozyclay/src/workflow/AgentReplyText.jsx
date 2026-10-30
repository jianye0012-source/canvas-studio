// The agent's reply as formatted text (reply-markdown.js): paragraphs, headings, lists, bold, code and tables,
// never the raw marks. `tail` (the streaming caret) sits at the end of the last line.
import { Fragment, useMemo } from "react";
import { replyBlocks } from "./reply-markdown.js";

function Spans({ spans }) {
	return spans.map((span, index) => {
		if (span.code) return <code key={index}>{span.text}</code>;
		if (span.bold) return <strong key={index}>{span.text}</strong>;
		return <Fragment key={index}>{span.text}</Fragment>;
	});
}

function Block({ block, tail }) {
	if (block.type === "h") return <p className="agent-reply-heading"><Spans spans={block.spans} />{tail}</p>;
	if (block.type === "code") return <pre><code>{block.text}</code>{tail}</pre>;
	if (block.type === "ul" || block.type === "ol") {
		const List = block.type;
		return <List start={block.start}>
			{block.items.map((spans, index) => <li key={index}><Spans spans={spans} />{index === block.items.length - 1 && tail}</li>)}
		</List>;
	}
	if (block.type === "table") return <>
		<div className="agent-reply-table"><table>
			<thead><tr>{block.head.map((spans, index) => <th key={index}><Spans spans={spans} /></th>)}</tr></thead>
			<tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((spans, index) => <td key={index}><Spans spans={spans} /></td>)}</tr>)}</tbody>
		</table></div>
		{tail}
	</>;
	return <p><Spans spans={block.spans} />{tail}</p>;
}

export function ReplyText({ text, tail = null }) {
	const blocks = useMemo(() => replyBlocks(text), [text]);
	if (!blocks.length) return tail || null;
	return blocks.map((block, index) => <Block key={index} block={block} tail={index === blocks.length - 1 ? tail : null} />);
}
