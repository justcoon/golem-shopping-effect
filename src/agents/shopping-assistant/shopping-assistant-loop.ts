import { Effect, Stream } from "effect";
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { extractLlmErrorMessage, fixMojibake, formatLlmErrorMessage } from "../../common/index.js";
import {
  ChatChunk,
  ChatMessage,
  ChatMessageType,
  ToolCallRecord,
} from "./shopping-assistant-schema.js";
import { getShoppingAssistantPiTools } from "./shopping-assistant-tools.js";

export { extractLlmErrorMessage, fixMojibake, formatLlmErrorMessage };

export const SYSTEM_PROMPT = `You are a helpful, courteous, and efficient personal Shopping Assistant for our e-commerce store.
You have access to tools to help the user:
- Search products and inspect live pricing (search_products)
- Get full details on a specific product (get_product_details)
- View current cart items, totals, and address (get_cart)
- Add items, update quantities, remove items, or clear cart (add_to_cart, update_cart_quantity, remove_from_cart, clear_cart)
- Check saved shipping/billing addresses and email from previous orders (get_saved_contact_info)
- Pre-fill the cart with saved contact details for 1-click checkout (apply_saved_contact_info)
- Manually set shipping address, billing address, or email on the cart (set_shipping_address, set_billing_address, set_email)
- Place the order (checkout_cart)
- Check order history or track a specific order (get_order_history, get_order_details)

Guidelines:
1. Be concise, polite, and directly address the user's intent.
2. When mentioning products, include their name, brand, and price.
3. For checkout:
   - Check if saved contact details exist using get_saved_contact_info.
   - If found, confirm with the user or apply via apply_saved_contact_info.
   - If it is their first order (no saved info found), ask for their shipping address and email, then use set_shipping_address, set_billing_address, and set_email before calling checkout_cart.
   - After checkout, celebrate the success and provide their order ID.
4. When showing order history, summarize recent orders clearly (status, total, date).
5. Output plain ASCII punctuation: use standard hyphens ('-') instead of special en-dashes ('–') or em-dashes ('—'), and standard quotes.`;

export interface ChatTurnResult {
  readonly reply: string;
  readonly toolCallsUsed: readonly ToolCallRecord[];
  readonly chunks: readonly ChatChunk[];
  readonly type: ChatMessageType;
}

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

  // 2. Native Google (when not targeting an OpenAI-compatible /openai subpath)
  if (
    !normalizedUrl.includes("/openai") &&
    (normalizedUrl.includes("generativelanguage.googleapis.com") || modelName.startsWith("gemini-"))
  ) {
    models.setProvider(googleProvider());
    const found = models.getModel("google", modelName);
    if (found) {
      return { models, resolvedModel: found };
    }
  }

  // 3. Fallback: Dynamic OpenAI-compatible provider (e.g. Gemini OpenAI endpoint or OpenRouter proxy)
  const endpointUrl = normalizedUrl || "https://generativelanguage.googleapis.com/v1beta/openai";
  const providerId = "dynamic-llm";
  const dynamicModel: Model<"openai-completions"> = {
    id: modelName,
    name: modelName,
    api: "openai-completions",
    provider: providerId,
    baseUrl: endpointUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    type: "chat",
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
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

export function executeChatTurn(options: {
  readonly userId: string;
  readonly apiKey: string;
  readonly model: string;
  readonly apiUrl?: string;
  readonly history: readonly ChatMessage[];
  readonly userMessage: string;
}): Effect.Effect<ChatTurnResult> {
  return Effect.gen(function* () {
    const { userId, apiKey, model, apiUrl, history, userMessage } = options;

    if (!apiKey) {
      const msg =
        "Shopping assistant is ready, but no LLM API key is configured. Please provide GEMINI_API_KEY or OPENROUTER_KEY in your environment or secrets.";
      return {
        reply: msg,
        toolCallsUsed: [],
        chunks: [
          { type: "text_delta" as const, content: msg, tool: "" },
          { type: "error" as const, content: msg, tool: "" },
          { type: "done" as const, content: "", tool: "" },
        ],
        type: "error" as ChatMessageType,
      };
    }

    const { models, resolvedModel } = setupModelsAndProvider({ apiKey, model, apiUrl });
    const tools = getShoppingAssistantPiTools(userId);

    // Convert prior history to Pi AgentMessage[] format
    const initialMessages: AgentMessage[] = [];
    for (const h of history) {
      if (h.role === "user") {
        initialMessages.push({
          role: "user",
          content: [{ type: "text", text: h.content }],
          timestamp: Date.now(),
        });
      } else if (h.role === "assistant") {
        initialMessages.push({
          role: "assistant",
          content: [{ type: "text", text: h.content }],
          api: resolvedModel.api,
          provider: resolvedModel.provider,
          model: resolvedModel.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        });
      }
    }

    const chunks: ChatChunk[] = [];
    const accumulatedToolCalls: ToolCallRecord[] = [];
    const toolArgsById = new Map<string, unknown>();
    let isError = false;
    let errorMessage = "";

    const agent = new Agent({
      initialState: {
        systemPrompt: SYSTEM_PROMPT,
        model: resolvedModel,
        tools,
        messages: initialMessages,
      },
      streamFn: models.streamSimple.bind(models),
      getApiKey: () => apiKey,
    });

    agent.subscribe((event) => {
      switch (event.type) {
        case "tool_execution_start": {
          toolArgsById.set(event.toolCallId, event.args);
          chunks.push({
            type: "tool_start",
            tool: event.toolName,
            content: `Executing ${event.toolName}...`,
          });
          break;
        }
        case "tool_execution_end": {
          const summary =
            event.result?.details?.summary ?? (event.isError ? "Failed" : "Completed");
          const resultString =
            event.result?.details?.resultString ?? JSON.stringify(event.result ?? {});
          chunks.push({
            type: "tool_result",
            tool: event.toolName,
            content: summary,
          });
          const rawArgs = toolArgsById.get(event.toolCallId);
          accumulatedToolCalls.push({
            id: event.toolCallId,
            toolName: event.toolName,
            arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs ?? {}),
            result: resultString,
          });
          break;
        }
        case "message_update": {
          const update = event.assistantMessageEvent;
          if (update.type === "text_delta" && update.delta) {
            chunks.push({
              type: "text_delta",
              content: update.delta,
              tool: "",
            });
          }
          break;
        }
        default:
          break;
      }
    });

    try {
      yield* Effect.promise(() => agent.prompt(userMessage));
    } catch (err: unknown) {
      isError = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    if (agent.state.errorMessage) {
      isError = true;
      errorMessage = agent.state.errorMessage;
    }

    let finalReply = "";
    if (isError) {
      const raw = errorMessage || "AI service request failed";
      const cleaned = extractLlmErrorMessage(400, raw);
      finalReply =
        cleaned && !cleaned.startsWith("HTTP 400")
          ? `AI service error: ${cleaned}`
          : `AI service error: ${raw}`;
      chunks.push({ type: "text_delta", content: finalReply, tool: "" });
      chunks.push({ type: "error", content: finalReply, tool: "" });
    } else {
      const lastMsg = agent.state.messages[agent.state.messages.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        for (const block of lastMsg.content) {
          if (block.type === "text") {
            finalReply += block.text;
          }
        }
      }
      finalReply = fixMojibake(finalReply);
      if (chunks.length === 0 || !chunks.some((c) => c.type === "text_delta")) {
        chunks.push({ type: "text_delta", content: finalReply, tool: "" });
      }
    }

    chunks.push({ type: "done", content: "", tool: "" });

    return {
      reply: finalReply,
      toolCallsUsed: accumulatedToolCalls,
      chunks,
      type: (isError ? "error" : "ok") as ChatMessageType,
    };
  });
}

export function executeChatTurnStream(options: {
  readonly userId: string;
  readonly apiKey: string;
  readonly model: string;
  readonly apiUrl?: string;
  readonly history: readonly ChatMessage[];
  readonly userMessage: string;
}): Stream.Stream<ChatChunk> {
  return Stream.fromEffect(executeChatTurn(options)).pipe(
    Stream.flatMap((result) => Stream.fromIterable(result.chunks)),
  );
}
