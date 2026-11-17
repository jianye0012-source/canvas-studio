export type TaskPollFailure = {
    count: number;
    failMessage?: string;
    warnMessage?: string;
};

function isAbortError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "name" in error && (error as { name?: unknown }).name === "AbortError";
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "";
}

export function taskPollFailure(previous: number, error: unknown): TaskPollFailure {
    if (isAbortError(error)) {
        return { count: previous };
    }
    const message = errorMessage(error) || "网络异常";
    const count = previous + 1;
    if (message.includes("任务不存在")) {
        return { count, failMessage: message };
    }
    if (count === 6) {
        return { count, warnMessage: `无法读取任务状态，正在重试：${message}` };
    }
    return { count };
}
