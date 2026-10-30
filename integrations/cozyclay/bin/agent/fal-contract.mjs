// Fal H3 Max Turbo I2V schema: https://fal.ai/models/minimax/h3-max-turbo/image-to-video/api
export const DEFAULT_FAL_VIDEO_MODEL = "minimax/h3-max-turbo/image-to-video";

export function falVideoContract(model = DEFAULT_FAL_VIDEO_MODEL) {
	if (model === DEFAULT_FAL_VIDEO_MODEL) return { name: "H3 Max Turbo", aspectFromImage: true, aspects: [], minDuration: 5, maxDuration: 15, integerDuration: true, defaultDuration: 5, resolution: ["480P", "768P", "1080P"], defaultResolution: "480P" };
	if (model === "fal-ai/bytedance/seedance/v1/pro/image-to-video") return { name: "Seedance v1 Pro", aspects: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], minDuration: 2, maxDuration: 12, defaultAspect: "16:9", defaultDuration: 5, resolution: ["480p", "720p", "1080p"], defaultResolution: "1080p" };
	throw Object.assign(new Error(`Unsupported Fal video model: ${model}. Use ${DEFAULT_FAL_VIDEO_MODEL}.`), { code: "fal-invalid-request" });
}
