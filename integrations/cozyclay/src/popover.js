import { useEffect, useRef } from "react";

// Shell popovers (the project menu, dropdowns, the Outliner context menu) are
// exclusive: opening one announces itself and every other open one closes, so
// two menus never stack over each other. Their surface and layer are the
// --popover-* / --z-popover tokens in src/styles/themes.css.
const POPOVER_OPEN_EVENT = "cozyclay:popover-open";

/**
 * Join the exclusive popover group while `open` is truthy. A new truthy
 * `open` value (a context menu re-opened at another row) announces again.
 * With `insideRefs`, a mousedown outside every ref also closes the popover.
 */
export function usePopover(open, close, insideRefs = null) {
	const live = useRef({ close, insideRefs });
	useEffect(() => {
		live.current = { close, insideRefs };
	});
	useEffect(() => {
		if (!open) return undefined;
		const token = {};
		window.dispatchEvent(new CustomEvent(POPOVER_OPEN_EVENT, { detail: token }));
		const onOtherOpen = (event) => {
			if (event.detail !== token) live.current.close();
		};
		const onDocMouseDown = (event) => {
			const refs = live.current.insideRefs;
			if (refs && !refs.some((ref) => ref.current?.contains(event.target))) live.current.close();
		};
		window.addEventListener(POPOVER_OPEN_EVENT, onOtherOpen);
		document.addEventListener("mousedown", onDocMouseDown);
		return () => {
			window.removeEventListener(POPOVER_OPEN_EVENT, onOtherOpen);
			document.removeEventListener("mousedown", onDocMouseDown);
		};
	}, [open]);
}
