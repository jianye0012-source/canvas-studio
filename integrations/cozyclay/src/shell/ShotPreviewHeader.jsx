import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function ShotPreviewHeader({ name, lens }) {
	const [host, setHost] = useState(null);
	useLayoutEffect(() => {
		setHost(document.querySelector(".vp-shot-preview .vp-shot-preview-tag"));
	}, []);
	if (!host) return null;
	return createPortal(
		<span className="vp-shot-preview-meta" data-testid="shot-preview-header">
			<span className="vp-shot-preview-name">{name}</span>
			<span className="vp-shot-preview-lens">{lens}</span>
		</span>,
		host,
	);
}
