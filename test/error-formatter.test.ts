import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractLlmErrorMessage,
  fixMojibake,
  formatLlmErrorMessage,
} from "../src/common/error-formatter.js";
import { summarizeToolResult } from "../src/agents/shopping-assistant/shopping-assistant-tool-specs.js";

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

  it("summarizes get_cart tool result with structured object or raw JSON", () => {
    const cartObject = {
      userId: "u001",
      items: [
        {
          productId: "ap005",
          productName: "Apple Watch Series 9",
          price: 429,
          quantity: 1,
        },
      ],
      total: 429,
      currency: "USD",
    };

    // Works with structured in-memory object directly
    const directSummary = summarizeToolResult("get_cart", cartObject);
    assert.strictEqual(directSummary, "1 item (USD 429.00)");

    // Also works with serialized JSON string
    const jsonSummary = summarizeToolResult("get_cart", JSON.stringify(cartObject));
    assert.strictEqual(jsonSummary, "1 item (USD 429.00)");
  });

  it("summarizes search_products tool result with structured array or raw JSON", () => {
    const products = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
    assert.strictEqual(summarizeToolResult("search_products", products), "Found 3 products");
    assert.strictEqual(
      summarizeToolResult("search_products", JSON.stringify(products)),
      "Found 3 products",
    );
  });
});
