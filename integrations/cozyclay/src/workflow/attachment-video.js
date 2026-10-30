/**
 * A video the author attaches to a turn. The turn envelope carries images
 * only, and the models behind it read pictures, not clips, so the composer
 * turns a video into one contact sheet: evenly spaced frames in a grid, each
 * stamped with its time. It costs one attachment slot and keeps the order of
 * the action legible to the model.
 */

const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "ogv", "mkv"]);
const SHEET_FRAMES = 9;
const SHEET_COLUMNS = 3;
const SHEET_CELL_WIDTH = 480;
const SHEET_JPEG_QUALITY = 0.85;

export function isVideoFile(file) {
	const declared = String(file?.type ?? "").toLowerCase();
	if (declared) return declared.startsWith("video/");
	const extension = String(file?.name ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
	return VIDEO_EXTENSIONS.has(extension);
}

function sheetTimes(duration, count) {
	return Array.from({ length: count }, (_, index) => (index + 0.5) * duration / count);
}

function formatSheetTime(seconds) {
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

function nextEvent(target, name) {
	return new Promise((resolve, reject) => {
		const done = () => { target.removeEventListener(name, done); target.removeEventListener("error", failed); resolve(); };
		const failed = () => { target.removeEventListener(name, done); target.removeEventListener("error", failed); reject(new Error("this browser cannot decode that video")); };
		target.addEventListener(name, done);
		target.addEventListener("error", failed);
	});
}

/**
 * One video file as a JPEG contact sheet `{ blob, name }`. Decoding happens in
 * a detached <video>; a codec the browser cannot play rejects instead of
 * producing a black sheet.
 */
export async function videoContactSheet(file, { doc = globalThis.document, frames = SHEET_FRAMES } = {}) {
	const url = URL.createObjectURL(file);
	const video = doc.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	try {
		const loaded = nextEvent(video, "loadeddata");
		video.src = url;
		await loaded;
		const { duration, videoWidth, videoHeight } = video;
		if (!Number.isFinite(duration) || duration <= 0 || !videoWidth || !videoHeight) throw new Error("that video has no usable length or size");
		const cellWidth = Math.min(SHEET_CELL_WIDTH, videoWidth);
		const cellHeight = Math.round(cellWidth * videoHeight / videoWidth);
		const canvas = doc.createElement("canvas");
		canvas.width = cellWidth * SHEET_COLUMNS;
		canvas.height = cellHeight * Math.ceil(frames / SHEET_COLUMNS);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("this browser cannot draw video frames — no 2D context");
		context.fillStyle = "#000";
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.font = `600 ${Math.max(12, Math.round(cellHeight / 12))}px system-ui, sans-serif`;
		context.textBaseline = "top";
		for (const [index, time] of sheetTimes(duration, frames).entries()) {
			const seeked = nextEvent(video, "seeked");
			video.currentTime = time;
			await seeked;
			const x = (index % SHEET_COLUMNS) * cellWidth;
			const y = Math.floor(index / SHEET_COLUMNS) * cellHeight;
			context.drawImage(video, x, y, cellWidth, cellHeight);
			const stamp = `${index + 1} · ${formatSheetTime(time)}`;
			const pad = 6;
			const box = context.measureText(stamp).width + pad * 2;
			context.fillStyle = "rgba(0, 0, 0, 0.6)";
			context.fillRect(x + 4, y + 4, box, Math.round(cellHeight / 12) + pad * 2);
			context.fillStyle = "#fff";
			context.fillText(stamp, x + 4 + pad, y + 4 + pad);
		}
		const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("the contact sheet could not be encoded")), "image/jpeg", SHEET_JPEG_QUALITY));
		const base = String(file?.name ?? "").trim() || "video";
		return { blob, name: `${base.slice(0, 70)} (${frames} frames over ${duration.toFixed(1)}s)` };
	} finally {
		video.removeAttribute("src");
		video.load();
		URL.revokeObjectURL(url);
	}
}
