/** Return the centred aspect rectangle in the canvas not covered by chrome. */
export function visibleViewOffset({ canvas, leftColumn, rightColumn, topbar, dock }, aspect) {
	if (!canvas || !Number.isFinite(aspect) || aspect <= 0) return null;
	const edge = (rect, side, fallback) => rect?.width > 0 && rect?.height > 0 ? rect[side] : fallback;
	const left = Math.max(canvas.left, edge(leftColumn, "right", canvas.left));
	const right = Math.min(canvas.right, edge(rightColumn, "left", canvas.right));
	const top = Math.max(canvas.top, edge(topbar, "bottom", canvas.top));
	const bottom = Math.min(canvas.bottom, edge(dock, "top", canvas.bottom));
	if (right - left < 50 || bottom - top < 50) return null;
	const centerX = (left + right) / 2;
	const centerY = (top + bottom) / 2;
	return {
		fullWidth: canvas.width,
		fullHeight: canvas.height,
		x: canvas.left + canvas.width / 2 - centerX,
		y: canvas.top + canvas.height / 2 - centerY,
		width: canvas.width,
		height: canvas.height,
	};
}

export function updateVisibleViewOffsets({ editorCam, poserCam, canvas, aspect }) {
	const offset = visibleViewOffset({
		canvas,
		leftColumn: document.querySelector(".studio-left-column")?.getBoundingClientRect(),
		rightColumn: document.querySelector(".studio-right-column")?.getBoundingClientRect(),
		topbar: document.querySelector(".topbar")?.getBoundingClientRect(),
		dock: document.querySelector(".studio-dock-slot")?.getBoundingClientRect(),
	}, aspect);
	for (const camera of [editorCam, poserCam]) if (camera) {
		camera.aspect = offset?.fullWidth / offset?.fullHeight || aspect;
		offset
			? camera.setViewOffset(offset.fullWidth, offset.fullHeight, offset.x, offset.y, offset.width, offset.height)
			: camera.clearViewOffset();
		camera.updateProjectionMatrix();
	}
}
