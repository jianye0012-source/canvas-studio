// Shot framing: one rule for every surface that shows the shot camera.
//
// The frustum is the shot camera's pose, its vertical FOV (camera.fov, the
// value a shot stores as fovDeg) and the shot aspect. The aspect only changes
// the horizontal extent, about the optical axis: a wider ratio extends the
// sides, a narrower one crops them, and the picture centre never moves. The
// exports render exactly that (CaptureRig: aspect = output width / height,
// fov untouched). The focal length shown for a ratio is that FOV read on the
// ratio's gate (shot.js usedSensorHeightMm), so it is a readout, not the
// invariant.
//
// On screen the frame is the largest centred rect of the shot aspect inside
// the pane, with bars around it. The dock preview pane is the card's picture
// slot; the Look through pane is the open stage between the panels (shell.css
// .vp-main under [data-shot-look]), never the whole canvas under them.

/** largest centred sub-rect of `rect` with the given aspect */
export function fitAspect(rect, aspect) {
	let w = rect.w;
	let h = w / aspect;
	if (h > rect.h) {
		h = rect.h;
		w = h * aspect;
	}
	return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}
