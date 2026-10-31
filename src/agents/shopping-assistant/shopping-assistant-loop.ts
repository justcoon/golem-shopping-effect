import { Effect, Stream } from "effect";
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { extractLlmErrorMessage, fixMojibake, formatLlmErrorMessage } from "../../common/index.js";
import {
  ChatChunk,
  ChatMessage,
  ChatMessageType,
  ToolCallRecord,
} from "./shopping-assistant-schema.js";
import { setupModelsAndProvider } from "./shopping-assistant-pi-provider.js";
import { getShoppingAssistantPiTools } from "./shopping-assistant-tools.js";

export { extractLlmErrorMessage, fixMojibake, formatLlmErrorMessage, setupModelsAndProvider };

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

function makeChunk(
  type: ChatChunk["type"],
  content = "",
  toolCall: Partial<ToolCallRecord> = {},
): ChatChunk {
  return {
    type,
    content,
    toolCall: {
      id: toolCall.id ?? "",
      toolName: toolCall.toolName ?? "",
      arguments: toolCall.arguments ?? "",
      result: toolCall.result ?? "",
    },
  };
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
        chunks: [makeChunk("text_delta", msg), makeChunk("error", msg), makeChunk("done", "")],
        type: "error" as ChatMessageType,
      };
    }

    const { models, resolvedModel } = setupModelsAndProvider({ apiKey, model, apiUrl });
    const context = yield* Effect.context();
    const tools = getShoppingAssistantPiTools(userId, context);

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

    const pushChunk = (
      type: ChatChunk["type"],
      content = "",
      toolCall: Partial<ToolCallRecord> = {},
    ) => {
      chunks.push(makeChunk(type, content, toolCall));
    };

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
          const argsString =
            typeof event.args === "string" ? event.args : JSON.stringify(event.args ?? {});
          toolArgsById.set(event.toolCallId, argsString);
          pushChunk("tool_start", `Executing ${event.toolName}...`, {
            id: event.toolCallId,
            toolName: event.toolName,
            arguments: argsString,
          });
          break;
        }
        case "tool_execution_end": {
          const summary =
            event.result?.details?.summary ?? (event.isError ? "Failed" : "Completed");
          const resultString =
            event.result?.details?.resultString ?? JSON.stringify(event.result ?? {});
          const rawArgs = (toolArgsById.get(event.toolCallId) as string) ?? "";
          pushChunk("tool_result", summary, {
            id: event.toolCallId,
            toolName: event.toolName,
            arguments: rawArgs,
            result: resultString,
          });
          accumulatedToolCalls.push({
            id: event.toolCallId,
            toolName: event.toolName,
            arguments: rawArgs,
            result: resultString,
          });
          break;
        }
        case "message_update": {
          const update = event.assistantMessageEvent;
          if (update.type === "text_delta" && update.delta) {
            pushChunk("text_delta", update.delta);
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
      pushChunk("text_delta", finalReply);
      pushChunk("error", finalReply);
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
        pushChunk("text_delta", finalReply);
      }
    }

    pushChunk("done", "");

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
