/**
 * Extracts an HTTP status code candidate from an error string, response text, or JSON payload.
 */
export function extractHttpStatus(text: string, defaultStatus = 500): number {
  if (!text) return defaultStatus;
  const trimmed = text.trim();

  // 1. Direct status prefix: e.g. "503 [...]" or "HTTP 503: [...]"
  const prefixMatch = trimmed.match(/^(?:HTTP\s*)?(\d{3})\b/i);
  if (prefixMatch && prefixMatch[1]) {
    const code = Number(prefixMatch[1]);
    if (code >= 400 && code < 600) return code;
  }

  // 2. Try JSON inspection for error.code or status code
  try {
    const jsonCandidate = trimmed.replace(/^(HTTP\s*)?\d+\s*:?\s*/i, "").trim();
    const parsed: unknown = JSON.parse(jsonCandidate || trimmed);
    const item: unknown = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : parsed;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const errObj = (record.error as Record<string, unknown>) ?? record;
      if (typeof errObj.code === "number" && errObj.code >= 400 && errObj.code < 600) {
        return errObj.code;
      }
      if (typeof errObj.status === "number" && errObj.status >= 400 && errObj.status < 600) {
        return errObj.status;
      }
      if (errObj.status === "UNAVAILABLE") return 503;
      if (errObj.status === "RESOURCE_EXHAUSTED") return 429;
      if (errObj.status === "UNAUTHENTICATED" || errObj.status === "PERMISSION_DENIED") return 401;
    }
  } catch {
    // Non-JSON string
  }

  // 3. Fallback pattern matching for common HTTP codes
  const anyCodeMatch = trimmed.match(/\b(401|403|429|503|500|502|504)\b/);
  if (anyCodeMatch && anyCodeMatch[1]) {
    return Number(anyCodeMatch[1]);
  }

  return defaultStatus;
}

/**
 * Maps an HTTP status code and optional details to a user-friendly, empathetic message.
 */
export function mapHttpErrorToUserMessage(status: number, _rawDetail?: string): string {
  switch (status) {
    case 401:
    case 403:
      return "AI authentication failed. Please check your API key configuration.";
    case 429:
      return "The AI assistant is temporarily busy due to rate limits. Please try again shortly.";
    case 503:
      return "The AI assistant is currently experiencing high demand. Please try again in a few moments.";
    default:
      return "The AI assistant is temporarily unavailable. Please try again later.";
  }
}

/**
 * Maps raw error output from an LLM service or agent failure to a clean, user-friendly message.
 */
export function mapLlmErrorToUserMessage(raw: string): string {
  if (!raw) {
    return "The AI assistant is temporarily unavailable. Please try again later.";
  }

  const lower = raw.toLowerCase();

  // Explicit keyword detection
  if (
    lower.includes("high demand") ||
    lower.includes("503") ||
    lower.includes("service unavailable") ||
    lower.includes("unavailable")
  ) {
    return mapHttpErrorToUserMessage(503);
  }

  if (
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("resource_exhausted")
  ) {
    return mapHttpErrorToUserMessage(429);
  }

  if (
    lower.includes("api key") ||
    lower.includes("authentication") ||
    lower.includes("unauthenticated") ||
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("403")
  ) {
    return mapHttpErrorToUserMessage(401);
  }

  const status = extractHttpStatus(raw, 500);
  return mapHttpErrorToUserMessage(status, raw);
}

/**
 * Extracts a clean, human-readable error message from an LLM API error response.
 * Handles JSON errors (including Gemini arrays `[{ error: ... }]` and standard `{ error: ... }`)
 * or falls back to plain text/status code.
 */
export function extractLlmErrorMessage(status: number, bodyText: string): string {
  if (bodyText) {
    const trimmed = bodyText.trim();
    const jsonCandidate = trimmed.replace(/^(HTTP\s*)?\d+\s*:?\s*/i, "").trim();
    try {
      const parsed: unknown = JSON.parse(jsonCandidate || trimmed);
      const item: unknown = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : parsed;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const errObj = (record.error as Record<string, unknown>) ?? record;
        const msg = errObj.message ?? errObj.detail ?? record.error;
        if (msg) return String(msg);
      }
    } catch {
      if (bodyText.includes("<title>")) {
        const match = bodyText.match(/<title>(.*?)<\/title>/i);
        if (match && match[1]) return match[1].trim();
      }
      return trimmed;
    }
  }
  return `HTTP ${status} error`;
}

/**
 * Returns a concise, transparent error description for the user.
 */
export function formatLlmErrorMessage(status: number, bodyText: string): string {
  const detail = extractLlmErrorMessage(status, bodyText);
  return `AI service error (${status}): ${detail}`;
}

export const formatLlmUserErrorMessage = formatLlmErrorMessage;

/**
 * Clean up common UTF-8 byte sequences incorrectly decoded as ISO-8859-1 or Windows-1252 (mojibake).
 */
export function fixMojibake(text: string): string {
  if (!text) return "";
  return text
    .replace(/â€“/g, "-")
    .replace(/â€”/g, " - ")
    .replace(/â€˜/g, "'")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€\x9d/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€¢/g, "•")
    .replace(/â€¦/g, "...")
    .replace(/Â /g, " ")
    .replace(/Â\$/g, "$")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, " - ");
}

/**
 * Formats an unknown error or rejection into a clear, descriptive string,
 * avoiding '[object Object]' for objects, typed failures, or Effect errors.
 */
export function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || String(err);
  }
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj._tag === "string") {
      const detail = obj.reason ?? obj.message ?? obj.cause ?? obj.val;
      return detail ? `${obj._tag}: ${formatUnknownError(detail)}` : obj._tag;
    }
    if (typeof obj.tag === "string" && "val" in obj) {
      return `${obj.tag}: ${formatUnknownError(obj.val)}`;
    }
    if (typeof obj.message === "string" && obj.message) return obj.message;
    if (typeof obj.reason === "string" && obj.reason) return obj.reason;
    try {
      return JSON.stringify(err);
    } catch {
      // Fall through to String(err) if circular
    }
  }
  return String(err);
}
