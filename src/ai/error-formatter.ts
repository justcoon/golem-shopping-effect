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
