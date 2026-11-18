import { isZh, ko } from "../locale.js";

export function localizedImportMessage(message) {
	if (!isZh) return message;
	const sentence = String(message).replace(/^(?:Not imported: |Could not import that model: |Could not import that image: )+/, "");
	const size = /^That model is too large to import — larger than (\d+) MB$/.exec(sentence);
	return ko("Import failed: ") + (size
		? ko("That model is too large to import — larger than N MB").replace("N", size[1])
		: ko(sentence));
}
