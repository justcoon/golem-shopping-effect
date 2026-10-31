import test from "node:test";
import assert from "node:assert/strict";
import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

test("custom OpenAI provider can be registered in createModels", () => {
  const models = createModels();
  const dynamicModel: Model<"openai-completions"> = {
    id: "gemini-3.1-flash-lite",
    name: "gemini-3.1-flash-lite",
    api: "openai-completions",
    provider: "test-openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    type: "chat",
  };

  const provider = createProvider({
    id: "test-openai",
    name: "Test OpenAI",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    auth: {
      apiKey: {
        name: "API Key",
        resolve: async () => ({
          auth: { apiKey: "test-key" },
          source: "API Key",
        }),
      },
    },
    models: [dynamicModel],
    api: openAICompletionsApi(),
  });

  models.setProvider(provider);
  const found = models.getModel("test-openai", "gemini-3.1-flash-lite");
  assert.ok(found);
  assert.equal(found.id, "gemini-3.1-flash-lite");
  assert.equal(found.api, "openai-completions");
});
