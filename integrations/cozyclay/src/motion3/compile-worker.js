// The motion compile worker: runs compile jobs (compile-job.js) off the editor's main thread, one at a time
// in arrival order, and answers each { id } with { id, value } (typed arrays transferred) or { id, error }.
// On the main thread the compiler runs about 4x slower than here (measured: 6.2 s against 1.5 s for a
// 240-frame carry) and blocks the viewport and the agent panel for the whole compile.
import { answerOf } from "./compile-job.js";

self.onmessage = ({ data }) => {
	const { message, transfer } = answerOf(data);
	self.postMessage(message, transfer);
};
