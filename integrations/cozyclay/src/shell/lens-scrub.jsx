import { useEffect, useRef, useState } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { ko } from "../locale.js";
import { PRESETS } from "../app-stage.jsx";
import { clampMm, dragMm, fovDegToMm, formatMm, lensRange, mmToFovDeg, nextPrime, previousPrime } from "./lens-scrub-math.js";
import "./lens-scrub.css";

// A drag starts after this many px; less is a click (the next prime).
const DRAG_SLOP = 3;
// A click waits this long so a double-click (reset) does not also step.
const CLICK_DELAY_MS = 220;

/** The Shot Camera card's focal length: drag left/right to change the lens.
 * A drag is one undo step (shotsDomain's gesture commits on pointer-up, Esc
 * cancels); a click steps to the next prime (the left arrow: the previous
 * one); a double-click resets. It is drawn as a field with arrows and a thumb
 * so it reads as something to drag, not as a label. */
export default function LensScrub({ fovDeg, sensorHeightMm, shotsDomain, disabled = false }) {
	const off = disabled || !shotsDomain || !Number.isFinite(fovDeg) || !(sensorHeightMm > 0);
	const range = off ? { min: 0, max: 0 } : lensRange(sensorHeightMm);
	const mm = off ? 0 : clampMm(fovDegToMm(fovDeg, sensorHeightMm), range);
	const drag = useRef(null);
	const clickTimer = useRef(0);
	const [dragging, setDragging] = useState(false);
	useEffect(() => () => clearTimeout(clickTimer.current), []);

	const setMm = (value) => shotsDomain.changeLens(mmToFovDeg(clampMm(value, range), sensorHeightMm));
	const onPointerDown = (event) => {
		if (off || event.button !== 0) return;
		event.currentTarget.setPointerCapture?.(event.pointerId);
		drag.current = { x: event.clientX, mm, moved: false, back: event.target.closest?.("[data-step]")?.dataset.step === "back" };
	};
	const onPointerMove = (event) => {
		const state = drag.current;
		if (!state) return;
		const dx = event.clientX - state.x;
		if (!state.moved) {
			if (Math.abs(dx) < DRAG_SLOP) return;
			state.moved = true;
			setDragging(true);
			shotsDomain.beginGesture();
		}
		setMm(dragMm(state.mm, dx, { fine: event.shiftKey, coarse: event.altKey }, range));
	};
	const onPointerUp = () => {
		const state = drag.current;
		drag.current = null;
		setDragging(false);
		if (!state || state.moved) return;
		clearTimeout(clickTimer.current);
		clickTimer.current = setTimeout(() => setMm((state.back ? previousPrime : nextPrime)(state.mm, range)), CLICK_DELAY_MS);
	};
	const onDoubleClick = () => {
		if (off) return;
		clearTimeout(clickTimer.current);
		shotsDomain.changeLens(PRESETS.medium.fov);
	};
	const onKeyDown = (event) => {
		if (off || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
		event.preventDefault();
		event.stopPropagation();
		const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowRight" ? 1 : -1);
		setMm(Math.round(mm + step));
	};

	return (
		<span
			className={"dock-lens-scrub" + (dragging ? " dragging" : "")}
			role="slider"
			tabIndex={off ? -1 : 0}
			aria-label={ko("Focal length", "초점 거리")}
			aria-disabled={off || undefined}
			aria-valuemin={range.min}
			aria-valuemax={range.max}
			aria-valuenow={mm}
			aria-valuetext={off ? ko("No shot camera", "샷 카메라 없음") : formatMm(mm)}
			aria-orientation="horizontal"
			title={ko("Focal length — drag to change, click an arrow for the next lens", "초점 거리 — 드래그해 변경, 화살표를 눌러 다음 렌즈")}
			data-testid="dock-lens-scrub"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={() => { drag.current = null; setDragging(false); }}
			onDoubleClick={onDoubleClick}
			onKeyDown={onKeyDown}
		>
			<span className="dock-lens-step" data-step="back" aria-hidden="true"><FiChevronLeft size={9} /></span>
			<span className="dock-lens-body">
				<span className="dock-lens-value">{off ? "— mm" : formatMm(mm)}</span>
				<span className="dock-lens-track" aria-hidden="true" style={{ "--lens-at": `${off ? 0 : ((mm - range.min) / (range.max - range.min)) * 100}%` }}>
					<span className="dock-lens-fill" />
					<span className="dock-lens-thumb" />
				</span>
			</span>
			<span className="dock-lens-step" data-step="next" aria-hidden="true"><FiChevronRight size={9} /></span>
		</span>
	);
}
