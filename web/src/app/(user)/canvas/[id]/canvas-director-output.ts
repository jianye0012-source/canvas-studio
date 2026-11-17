export type DirectorOutputResult = {
    ok: boolean;
    error?: string;
};

const directorRequestIdPattern = /^[a-f0-9-]{36}$/;

export function directorErrorText(error: unknown, limit: number): string {
    const message = error instanceof Error ? error.message : "未知错误";
    return message.slice(0, limit);
}

export function directorOutputError(kind: "截图" | "视频", error: unknown): string {
    return `${kind}发送到画布失败：${directorErrorText(error, 200)}`;
}

export function isValidDirectorRequestId(requestId: unknown): requestId is string {
    return typeof requestId === "string" && directorRequestIdPattern.test(requestId);
}

export function createDirectorOutputDedupe(options: { now?: () => number; ttlMs?: number } = {}) {
    const now = options.now ?? Date.now;
    const ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    const entries = new Map<string, { promise: Promise<DirectorOutputResult>; at: number }>();

    function run(requestId: unknown, handler: () => Promise<DirectorOutputResult>): Promise<DirectorOutputResult> {
        if (!isValidDirectorRequestId(requestId)) {
            return handler().catch((error): DirectorOutputResult => ({ ok: false, error: directorErrorText(error, 300) }));
        }
        const at = now();
        for (const [id, entry] of entries) {
            if (at - entry.at > ttlMs) entries.delete(id);
        }
        const existing = entries.get(requestId);
        if (existing) return existing.promise;
        const promise = handler().catch((error): DirectorOutputResult => ({ ok: false, error: directorErrorText(error, 300) }));
        entries.set(requestId, { promise, at });
        return promise;
    }

    return { run };
}
