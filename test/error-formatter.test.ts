import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractHttpStatus,
  extractLlmErrorMessage,
  fixMojibake,
  formatLlmErrorMessage,
  formatUnknownError,
  mapHttpErrorToUserMessage,
  mapLlmErrorToUserMessage,
} from "../src/ai/error-formatter.js";

describe("LLM Error Formatting", () => {
  it("parses array error format from Gemini HTTP 503 transparently", () => {
    const rawGemini503 = JSON.stringify([
      {
        error: {
          code: 503,
          message:
            "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
          status: "UNAVAILABLE",
        },
      },
    ]);

    const extracted = extractLlmErrorMessage(503, rawGemini503);
    assert.strictEqual(
      extracted,
      "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
    );

    const formatted = formatLlmErrorMessage(503, rawGemini503);
    assert.strictEqual(
      formatted,
      "AI service error (503): This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",
    );
  });

  it("parses error string prefixed with HTTP status code", () => {
    const raw400 =
      '400 [{"error":{"code":400,"message":"Invalid JSON payload received. Unknown name \\"store\\": Cannot find field.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.rpc.BadRequest","fieldViolations":[{"description":"Invalid JSON payload received. Unknown name \\"store\\": Cannot find field."}]}]}}]';
    const extracted = extractLlmErrorMessage(400, raw400);
    assert.strictEqual(
      extracted,
      'Invalid JSON payload received. Unknown name "store": Cannot find field.',
    );
  });

  it("parses standard object error format (HTTP 429 rate limit)", () => {
    const raw429 = JSON.stringify({
      error: {
        code: 429,
        message: "You exceeded your current quota, please check your plan and billing details.",
        type: "insufficient_quota",
      },
    });

    const extracted = extractLlmErrorMessage(429, raw429);
    assert.strictEqual(
      extracted,
      "You exceeded your current quota, please check your plan and billing details.",
    );

    const formatted = formatLlmErrorMessage(429, raw429);
    assert.strictEqual(
      formatted,
      "AI service error (429): You exceeded your current quota, please check your plan and billing details.",
    );
  });

  it("parses HTTP 401 authentication error", () => {
    const raw401 = JSON.stringify({
      error: {
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
      },
    });

    const extracted = extractLlmErrorMessage(401, raw401);
    assert.strictEqual(extracted, "API key not valid. Please pass a valid API key.");

    const formatted = formatLlmErrorMessage(401, raw401);
    assert.strictEqual(
      formatted,
      "AI service error (401): API key not valid. Please pass a valid API key.",
    );
  });

  it("handles HTML error responses gracefully", () => {
    const rawHtml =
      "<html><head><title>503 Service Temporarily Unavailable</title></head><body><h1>503</h1></body></html>";
    const extracted = extractLlmErrorMessage(503, rawHtml);
    assert.strictEqual(extracted, "503 Service Temporarily Unavailable");

    const formatted = formatLlmErrorMessage(503, rawHtml);
    assert.strictEqual(formatted, "AI service error (503): 503 Service Temporarily Unavailable");
  });

  it("fixes mojibake encoding corruption (â€“ to -)", () => {
    const corrupted = "Apple Watch Series 9 by Apple â€“ $429.00 (Quantity: 1)";
    const cleaned = fixMojibake(corrupted);
    assert.strictEqual(cleaned, "Apple Watch Series 9 by Apple - $429.00 (Quantity: 1)");
  });

  it("formats unknown errors without returning [object Object]", () => {
    assert.strictEqual(formatUnknownError(new Error("standard error")), "standard error");
    assert.strictEqual(
      formatUnknownError({ message: "custom message error" }),
      "custom message error",
    );
    assert.strictEqual(
      formatUnknownError({ _tag: "RemoteResponseError", reason: "failed to encode input" }),
      "RemoteResponseError: failed to encode input",
    );
    assert.strictEqual(
      formatUnknownError({ tag: "protocol-error", val: "connection lost" }),
      "protocol-error: connection lost",
    );
    assert.strictEqual(formatUnknownError({ arbitrary: 123 }), '{"arbitrary":123}');
    assert.strictEqual(formatUnknownError("plain string error"), "plain string error");
  });

  it("extracts HTTP status codes accurately from diverse error payloads", () => {
    assert.strictEqual(extractHttpStatus("503 Service Unavailable"), 503);
    assert.strictEqual(extractHttpStatus("HTTP 429: Too Many Requests"), 429);
    assert.strictEqual(
      extractHttpStatus('{"error":{"code":401,"message":"API key not valid"}}'),
      401,
    );
    assert.strictEqual(extractHttpStatus('[{"error":{"code":503,"status":"UNAVAILABLE"}}]'), 503);
    assert.strictEqual(extractHttpStatus("unknown network error", 502), 502);
  });

  it("maps HTTP error statuses to polite, user-facing error messages", () => {
    assert.strictEqual(
      mapHttpErrorToUserMessage(503),
      "The AI assistant is currently experiencing high demand. Please try again in a few moments.",
    );
    assert.strictEqual(
      mapHttpErrorToUserMessage(429),
      "The AI assistant is temporarily busy due to rate limits. Please try again shortly.",
    );
    assert.strictEqual(
      mapHttpErrorToUserMessage(401),
      "AI authentication failed. Please check your API key configuration.",
    );
    assert.strictEqual(
      mapHttpErrorToUserMessage(403),
      "AI authentication failed. Please check your API key configuration.",
    );
    assert.strictEqual(
      mapHttpErrorToUserMessage(500),
      "The AI assistant is temporarily unavailable. Please try again later.",
    );
  });

  it("maps raw technical LLM error strings to clean user-facing messages", () => {
    const raw503 =
      '[{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}]';
    assert.strictEqual(
      mapLlmErrorToUserMessage(raw503),
      "The AI assistant is currently experiencing high demand. Please try again in a few moments.",
    );

    const raw429 = '429 {"error":{"message":"Rate limit exceeded"}}';
    assert.strictEqual(
      mapLlmErrorToUserMessage(raw429),
      "The AI assistant is temporarily busy due to rate limits. Please try again shortly.",
    );

    const raw401 = '{"error":{"message":"API key not valid. Please pass a valid API key."}}';
    assert.strictEqual(
      mapLlmErrorToUserMessage(raw401),
      "AI authentication failed. Please check your API key configuration.",
    );

    assert.strictEqual(
      mapLlmErrorToUserMessage("socket hang up"),
      "The AI assistant is temporarily unavailable. Please try again later.",
    );
  });
});
