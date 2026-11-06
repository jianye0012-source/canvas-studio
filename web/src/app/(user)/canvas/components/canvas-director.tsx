"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEffectiveConfig } from "@/stores/use-config-store";

import type { CanvasDirectorCapture, CanvasDirectorPanorama, CanvasDirectorVideo } from "../types";

type PanoramaRemoval = Pick<CanvasDirectorPanorama, "edgeId" | "sourceNodeId">;
type DirectorCapturePayload = { dataUrl?: unknown; fileName?: unknown } | null | undefined;

export function CanvasDirector({
    nodeId,
    project,
    panoramas,
    theme,
    onClose,
    onProjectChange,
    onPanoramaRemoved,
    onCapturesSent,
    onVideoSent,
}: {
    nodeId: string;
    project: unknown;
    panoramas: CanvasDirectorPanorama[];
    theme: "light" | "dark";
    onClose: () => void;
    onProjectChange: (project: unknown) => void;
    onPanoramaRemoved: (payload: PanoramaRemoval) => void;
    onCapturesSent: (nodeId: string, captures: CanvasDirectorCapture[]) => Promise<boolean | void>;
    onVideoSent: (nodeId: string, video: CanvasDirectorVideo) => Promise<boolean | void>;
}) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const projectRef = useRef(project);
    const themeRef = useRef(theme);
    const imageConfig = useEffectiveConfig();
    const imageConfigRef = useRef(imageConfig);
    imageConfigRef.current = imageConfig;
    const imageRequestsRef = useRef(new Map<string, AbortController>());
    const [readyEpoch, setReadyEpoch] = useState(0);

    useEffect(() => {
        projectRef.current = project;
    }, [project]);

    useEffect(() => {
        themeRef.current = theme;
    }, [theme]);

    const postToDesk = useCallback((type: string, payload: unknown) => {
        iframeRef.current?.contentWindow?.postMessage({ type, payload }, window.location.origin);
    }, []);

    useEffect(() => () => { for (const controller of imageRequestsRef.current.values()) controller.abort(); imageRequestsRef.current.clear(); }, [nodeId]);

    useEffect(() => {
        function handleMessage(event: MessageEvent) {
            if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;

            const type = event.data?.type;
            if (type === "storyai:director-image-cancel") { imageRequestsRef.current.get(event.data?.payload?.requestId)?.abort(); return; }
            if (type === "storyai:director-image-request") {
                const requestId = event.data?.payload?.requestId;
                if (typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId) || imageRequestsRef.current.has(requestId)) return;
                const controller = new AbortController();
                imageRequestsRef.current.set(requestId, controller);
                void import("./director-image-generation").then(async ({ generateDirectorImage }) => {
                    const image = await generateDirectorImage(imageConfigRef.current, event.data?.payload || {}, nodeId, requestId, controller.signal);
                    controller.signal.throwIfAborted();
                    if (await onCapturesSent(nodeId, [{ dataUrl: image.dataUrl, fileName: "导演台建模参考图.png" }]) === false) throw new Error("生成的建模参考图未保存，请检查数据目录");
                    postToDesk("storyai:director-image-result", { requestId, ok: true, ...image });
                }).catch(error => postToDesk("storyai:director-image-result", { requestId, ok: false, error: error instanceof Error ? error.message : "图片生成失败" })).finally(() => imageRequestsRef.current.delete(requestId));
                return;
            }
            if (type === "storyai:director-ready") {
                setReadyEpoch(value => value + 1);
                return;
            }

            if (type === "storyai:director-close") {
                onClose();
                return;
            }

            if (type === "storyai:director-project-changed") {
                const nextProject = event.data?.payload?.project;
                if (nextProject && typeof nextProject === "object" && !Array.isArray(nextProject)) onProjectChange(nextProject);
                return;
            }

            if (type === "storyai:director-panorama-removed") {
                const edgeId = typeof event.data?.payload?.edgeId === "string" ? event.data.payload.edgeId.trim() : "";
                const sourceNodeId = typeof event.data?.payload?.sourceNodeId === "string" ? event.data.payload.sourceNodeId.trim() : "";
                if (edgeId && sourceNodeId) onPanoramaRemoved({ edgeId, sourceNodeId });
                return;
            }

            if (type === "storyai:director-captures-sent") {
                const captures = Array.isArray(event.data?.payload?.captures)
                    ? event.data.payload.captures
                        .filter((capture: DirectorCapturePayload): capture is { dataUrl: string; fileName?: unknown } => typeof capture?.dataUrl === "string" && capture.dataUrl.startsWith("data:image/"))
                        .map((capture: { dataUrl: string; fileName?: unknown }, index: number) => ({ dataUrl: capture.dataUrl, fileName: typeof capture.fileName === "string" && capture.fileName.trim() ? capture.fileName.trim() : "导演台截图-" + (index + 1) + ".png" }))
                    : [];
                if (!captures.length) { postToDesk("storyai:director-output-result", { requestId: event.data?.payload?.requestId, ok: false, error: "没有收到有效的导演台截图" }); return; }
                void onCapturesSent(nodeId, captures)
                    .then((ok) => postToDesk("storyai:director-output-result", { requestId: event.data?.payload?.requestId, ok: ok !== false }))
                    .catch(error => postToDesk("storyai:director-output-result", { requestId: event.data?.payload?.requestId, ok: false, error: error instanceof Error ? error.message : "截图保存失败" }));
                return;
            }

            if (type === "storyai:director-video-sent") {
                const blob = event.data?.payload?.blob;
                if (!(blob instanceof Blob) || !blob.size || !blob.type.startsWith("video/mp4")) { postToDesk("storyai:director-output-result", { requestId: event.data?.payload?.requestId, ok: false, error: "没有收到有效的 MP4 动画" }); return; }
                const fileName = typeof event.data?.payload?.fileName === "string" && event.data.payload.fileName.trim()
                    ? event.data.payload.fileName.trim()
                    : "导演台视频.mp4";
                const width = Number(event.data?.payload?.width);
                const height = Number(event.data?.payload?.height);
                const durationSeconds = Number(event.data?.payload?.durationSeconds);
                void onVideoSent(nodeId, {
                    blob,
                    fileName,
                    width: Number.isFinite(width) && width > 0 ? width : 1280,
                    height: Number.isFinite(height) && height > 0 ? height : 720,
                    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
                }).then((ok) => postToDesk("storyai:director-output-result", { requestId: event.data?.payload?.requestId, ok: ok !== false }))
                    .catch(error => postToDesk("storyai:director-output-result", { requestId: event.data?.payload?.requestId, ok: false, error: error instanceof Error ? error.message : "动画保存失败" }));
                return;
            }
        }

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [nodeId, onCapturesSent, onClose, onPanoramaRemoved, onProjectChange, onVideoSent, postToDesk]);

    useEffect(() => {
        if (!readyEpoch) return;
        postToDesk("storyai:director-session", {
            instanceId: nodeId,
            theme: themeRef.current,
            project: projectRef.current,
        });
    }, [nodeId, postToDesk, readyEpoch]);

    useEffect(() => {
        if (!readyEpoch) return;
        postToDesk("storyai:director-panoramas", { panoramas });
    }, [panoramas, postToDesk, readyEpoch]);

    return (
        <div className="fixed inset-0 z-[2000]">
            <iframe key={nodeId} ref={iframeRef} title="3D导演台" src="/cozy/app/?canvas=1" className="block h-full w-full border-0" />
        </div>
    );
}
