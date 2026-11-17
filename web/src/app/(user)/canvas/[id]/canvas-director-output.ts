export function directorErrorText(error: unknown, limit: number): string {
    const message = error instanceof Error ? error.message : "未知错误";
    return message.slice(0, limit);
}

export function directorOutputError(kind: "截图" | "视频", error: unknown): string {
    return `${kind}发送到画布失败：${directorErrorText(error, 200)}`;
}
