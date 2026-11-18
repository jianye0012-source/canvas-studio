export function hasPendingSubmission(run?: { submission?: unknown }): boolean {
    return Boolean(run?.submission);
}
