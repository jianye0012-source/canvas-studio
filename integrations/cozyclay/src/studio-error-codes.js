// The error codes a Studio receipt or failure may carry. Shared by the browser
// and sidecar; no imports.
export const STUDIO_ERROR_CODES = Object.freeze([
	"INVALID_ARGUMENT", "INVALID_CONTEXT", "INVALID_IDENTITY", "INVALID_TURN_ID", "INVALID_SESSION_ID", "INVALID_RECEIPT", "INVALID_RANGE", "INVALID_REQUEST",
	"UNKNOWN_TOOL", "UNKNOWN_VARIANT", "DUPLICATE_NAME", "CONTEXT_LIMIT", "CONTEXT_TOO_LARGE", "AMBIGUOUS_TARGET", "AMBIGUOUS_BASIS", "TARGET_NOT_READY", "TARGET_BUSY",
	"STALE_TARGET", "STALE_SCENE", "STALE_ENVIRONMENT", "STALE_CURSOR", "CAPABILITY_MISSING", "LIVE_HUB_UNAVAILABLE", "AUTH_REQUIRED", "GENERATION_LIMIT", "RATE_LIMITED", "BACKEND_UNAVAILABLE",
	"VERIFICATION_FAILED", "REPAIR_REGRESSED", "CANCELLED", "UNCERTAIN_APPLY", "UNDO_CONFLICT", "CONFIRMATION_REQUIRED", "TIMEOUT", "UNDO_EXPIRED", "INTERNAL_ERROR", "SCOPE_DENIED", "SCOPE_BUSY",
]);
/**
 * A refusal's code. A protocol error carries its own; a JavaScript runtime error (TypeError, ReferenceError, RangeError,
 * SyntaxError) is a fault in the editor, never the caller's input, so it reads INTERNAL_ERROR; any other plain Error is
 * the validation message of a command and stays INVALID_ARGUMENT.
 */
export const refusalCode = error => error?.code
	?? (["TypeError", "ReferenceError", "RangeError", "SyntaxError"].includes(error?.name) ? "INTERNAL_ERROR" : "INVALID_ARGUMENT");
