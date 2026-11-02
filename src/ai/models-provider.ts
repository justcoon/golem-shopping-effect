import {
  createModels,
  createProvider,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

/**
 * Resolves or creates a model and registered provider in Pi AI.
 */
export function setupModelsAndProvider(options: {
  apiKey: string;
  model: string;
  apiUrl?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): { models: MutableModels; resolvedModel: Model<any> } {
  const { apiKey, model: modelName, apiUrl } = options;
  const models = createModels();
  const normalizedUrl = apiUrl ? apiUrl.replace(/\/chat\/completions$/, "").replace(/\/$/, "") : "";

  // 1. OpenRouter
  if (modelName.startsWith("openrouter/") || normalizedUrl.includes("openrouter.ai")) {
    models.setProvider(openrouterProvider());
    const strippedId = modelName.startsWith("openrouter/")
      ? modelName.slice("openrouter/".length)
      : modelName;
    const found =
      models.getModel("openrouter", strippedId) ?? models.getModel("openrouter", modelName);
    if (found) {
      return { models, resolvedModel: found };
    }
  }

  // 2. Google Generative AI (natively handles Gemini thought signatures for multi-turn tool calling)
  if (
    modelName.startsWith("gemini-") ||
    normalizedUrl.includes("generativelanguage.googleapis.com")
  ) {
    models.setProvider(googleProvider());
    const found = models.getModel("google", modelName);
    if (found) {
      return { models, resolvedModel: found };
    }
  }

  // 3. Fallback: Dynamic OpenAI-compatible provider (e.g. custom LLM gateway or local server)
  const endpointUrl = normalizedUrl || "https://generativelanguage.googleapis.com/v1beta/openai";
  const providerId = "dynamic-llm";
  const isGoogleOpenAi = endpointUrl.includes("generativelanguage.googleapis.com");
  const dynamicModel: Model<"openai-completions"> = {
    id: modelName,
    name: modelName,
    api: "openai-completions",
    provider: providerId,
    baseUrl: endpointUrl,
    reasoning: isGoogleOpenAi,
    thinkingLevelMap: isGoogleOpenAi ? { off: "none" } : undefined,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    type: "chat",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
      supportsReasoningEffort: isGoogleOpenAi,
    },
  };

  const provider = createProvider({
    id: providerId,
    name: "Dynamic LLM Provider",
    baseUrl: endpointUrl,
    auth: {
      apiKey: {
        name: "API Key",
        resolve: async () => ({
          auth: { apiKey },
          source: "API Key",
        }),
      },
    },
    models: [dynamicModel],
    api: openAICompletionsApi(),
  });

  models.setProvider(provider);
  return { models, resolvedModel: dynamicModel };
}
