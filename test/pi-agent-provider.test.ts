import test from "node:test";
import assert from "node:assert/strict";
import { createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { setupModelsAndProvider } from "../src/ai/index.js";

test("custom OpenAI provider can be registered in createModels", () => {
  const models = createModels();
  const dynamicModel: Model<"openai-completions"> = {
    id: "test-model",
    name: "test-model",
    api: "openai-completions",
    provider: "test-openai",
    baseUrl: "https://example.com/v1",
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
    baseUrl: "https://example.com/v1",
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
  const found = models.getModel("test-openai", "test-model");
  assert.ok(found);
  assert.equal(found.id, "test-model");
  assert.equal(found.api, "openai-completions");
});

test("setupModelsAndProvider routes Gemini models to native Google Generative AI provider", () => {
  const result = setupModelsAndProvider({
    apiKey: "dummy-key",
    model: "gemini-3.1-flash-lite",
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  });

  assert.equal(result.resolvedModel.provider, "google");
  assert.equal(result.resolvedModel.id, "gemini-3.1-flash-lite");
  assert.equal(result.resolvedModel.api, "google-generative-ai");
});

test("setupModelsAndProvider routes OpenRouter models to openrouter provider", () => {
  const result = setupModelsAndProvider({
    apiKey: "dummy-key",
    model: "openrouter/free",
  });

  assert.equal(result.resolvedModel.provider, "openrouter");
});

test("setupModelsAndProvider routes custom endpoints to dynamic OpenAI provider", () => {
  const result = setupModelsAndProvider({
    apiKey: "dummy-key",
    model: "llama-3-70b",
    apiUrl: "https://my-custom-llm.internal/v1",
  });

  assert.equal(result.resolvedModel.provider, "dynamic-llm");
  assert.equal(result.resolvedModel.api, "openai-completions");
});
