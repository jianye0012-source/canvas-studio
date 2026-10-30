/**
 * A text record in the set: flat lettering drawn on a card, or solid letters
 * extruded from the bundled typeface. Both fill the box text-record.js
 * measures (x centred, y = 0 the bottom of the lowest line, facing +z), so the
 * footprint, the selection cage and placement agree with what is drawn.
 */
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { autoFlat } from "../auto-flat.js";
import { textIsSolid, textLayout } from "./text-record.js";

// The app's own sans first, then the system's, which carries Hangul and CJK.
const FLAT_FAMILY = "Inter, system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
/** A system sans capital is about this many em tall. */
const CAP_PER_EM = 0.72;
/** Texture pixels per capital height, and the largest texture side. */
const CAP_PIXELS = 160, MAX_SIDE = 2048;

let fontPromise = null;
/** The typeface, fetched from the app's own bundle the first time solid letters are drawn. */
const loadFont = () => (fontPromise ??= import("./fonts/helvetiker-bold.typeface.json").then((module) => new Font(module.default ?? module)));

/** Flat lettering, white on clear, scaled into the measured box. */
function flatTexture(text, layout) {
	const ppm = Math.min(CAP_PIXELS / text.size, MAX_SIDE / Math.max(layout.width, layout.height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(2, Math.ceil(layout.width * ppm));
	canvas.height = Math.max(2, Math.ceil(layout.height * ppm));
	const context = canvas.getContext("2d");
	let px = (text.size * ppm) / CAP_PER_EM;
	context.font = `700 ${px}px ${FLAT_FAMILY}`;
	// The system face is not the typeface the box was measured with: shrink to fit the widest line.
	const widest = Math.max(1, ...layout.rows.map((row) => context.measureText(row.text).width));
	px *= Math.min(1, canvas.width / widest);
	context.font = `700 ${px}px ${FLAT_FAMILY}`;
	context.fillStyle = "#ffffff";
	context.textBaseline = "alphabetic";
	context.textAlign = text.align;
	const x = text.align === "left" ? 0 : text.align === "right" ? canvas.width : canvas.width / 2;
	for (const row of layout.rows) context.fillText(row.text, x, canvas.height - row.baseline * ppm);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 4;
	return texture;
}

/** Re-renders once the page's web fonts have loaded, so flat lettering is not drawn in a fallback face. */
function useFontsReady() {
	const [ready, setReady] = useState(() => typeof document === "undefined" || document.fonts?.status === "loaded");
	useEffect(() => {
		let live = true;
		document.fonts?.ready.then(() => live && setReady(true));
		return () => { live = false; };
	}, []);
	return ready;
}

function useSolidFont(solid) {
	const [font, setFont] = useState(null);
	useEffect(() => {
		let live = true;
		if (solid) loadFont().then((loaded) => live && setFont(loaded));
		return () => { live = false; };
	}, [solid]);
	return solid ? font : null;
}

function materialProps(object) {
	return object.autoColor ? autoFlat(object.autoColor) : { color: object.color, roughness: 0.82, metalness: 0 };
}

function FlatText({ object, layout }) {
	const fontsReady = useFontsReady();
	// fontsReady draws the card again once the page's web fonts have loaded.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const texture = useMemo(() => flatTexture(object.text, layout), [object.text, layout, fontsReady]);
	useEffect(() => () => texture.dispose(), [texture]);
	return (
		<mesh position={[0, layout.height / 2, 0]} castShadow receiveShadow>
			<planeGeometry args={[layout.width, layout.height]} />
			<meshStandardMaterial {...materialProps(object)} map={texture} side={THREE.DoubleSide} alphaTest={0.15} alphaToCoverage />
		</mesh>
	);
}

function SolidText({ object, layout, font }) {
	const { depth } = object.text;
	// One extruded line per row, moved onto the row's left edge and baseline, centred in depth.
	const lines = useMemo(() => layout.rows.filter((row) => row.text.trim()).map((row) =>
		new TextGeometry(row.text, { font, size: object.text.size, depth, curveSegments: 6, bevelEnabled: false }).translate(row.x, row.baseline, -depth / 2)),
	[font, layout, object.text.size, depth]);
	useEffect(() => () => lines.forEach((line) => line.dispose()), [lines]);
	return lines.map((part, i) => (
		<mesh key={i} geometry={part} castShadow receiveShadow>
			<meshStandardMaterial {...materialProps(object)} />
		</mesh>
	));
}

export function TextObject({ object }) {
	const layout = useMemo(() => textLayout(object.text), [object.text]);
	const font = useSolidFont(textIsSolid(object.text));
	return font ? <SolidText object={object} layout={layout} font={font} /> : <FlatText object={object} layout={layout} />;
}
