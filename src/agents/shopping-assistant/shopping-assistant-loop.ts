import { Duration, Effect, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { Retry } from "@golemcloud/effect-golem";
import { safeJsonStringify } from "../../common/index.js";
import { ChatChunk, ChatMessage, ToolCallRecord } from "./shopping-assistant-schema.js";
import { toolsMap, toolsOpenAiFormat } from "./shopping-assistant-tools.js";

const SYSTEM_PROMPT = `You are a helpful, courteous, and efficient personal Shopping Assistant for our e-commerce store.
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
4. When showing order history, summarize recent orders clearly (status, total, date).`;

const llmRetryPolicy = Retry.NamedPolicy.named(
  "shopping-assistant-chat-retry",
  Retry.Policy.exponential(Duration.millis(1000), 2).withJitter(0.2).maxRetries(3),
);

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
}

export interface ChatTurnResult {
  readonly reply: string;
  readonly toolCallsUsed: readonly ToolCallRecord[];
  readonly chunks: readonly ChatChunk[];
}

export function executeChatTurn(options: {
  readonly userId: string;
  readonly apiKey: string;
  readonly model: string;
  readonly apiUrl?: string;
  readonly history: readonly ChatMessage[];
  readonly userMessage: string;
}) {
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
          { type: "done" as const, content: "", tool: "" },
        ],
      };
    }

    const endpoint = apiUrl
      ? `${apiUrl.replace(/\/$/, "")}/chat/completions`
      : "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

    const messages: OpenAiMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

    // Append prior history
    for (const h of history) {
      if (h.role === "user" || h.role === "assistant") {
        messages.push({ role: h.role, content: h.content });
      }
    }

    // Append current user message
    messages.push({ role: "user", content: userMessage });

    const accumulatedToolCalls: ToolCallRecord[] = [];
    const chunks: ChatChunk[] = [];
    let finalReply = "";

    const MAX_STEPS = 5;
    for (let step = 0; step < MAX_STEPS; step++) {
      const payload = {
        model,
        messages,
        tools: toolsOpenAiFormat,
      };

      let lastErrorMessage = "";
      const postEffect = HttpClientRequest.post(endpoint).pipe(
        HttpClientRequest.setHeaders({
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://golem.cloud",
          "X-Title": "Golem Shopping Effect",
        }),
        HttpClientRequest.bodyText(safeJsonStringify(payload), "application/json"),
        HttpClient.execute,
        Effect.flatMap((response) =>
          Effect.gen(function* () {
            if (response.status >= 200 && response.status < 300) {
              return yield* response.json;
            }
            const bodyText = yield* response.text.pipe(Effect.catch(() => Effect.succeed("")));
            let msg = `HTTP ${response.status}`;
            try {
              const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
              if (parsed?.error?.message) {
                msg += `: ${parsed.error.message}`;
              } else if (bodyText) {
                msg += `: ${bodyText}`;
              }
            } catch {
              if (bodyText) msg += `: ${bodyText}`;
            }
            lastErrorMessage = msg;
            return yield* Effect.fail(new Error(msg));
          }),
        ),
        Effect.provide(FetchHttpClient.layer),
      );

      const responseJson = yield* Retry.withPolicy(llmRetryPolicy, postEffect).pipe(
        Effect.catch((err: unknown) =>
          Effect.logWarning(`LLM chat request failed: ${err}`).pipe(
            Effect.as(null as OpenAiChatCompletionResponse | null),
          ),
        ),
      );

      const parsedResponse = responseJson as OpenAiChatCompletionResponse | null;
      if (!parsedResponse?.choices || parsedResponse.choices.length === 0) {
        finalReply = lastErrorMessage
          ? `AI service error: ${lastErrorMessage}`
          : "I encountered an error communicating with the AI service. Please try again in a moment.";
        chunks.push({ type: "error", content: finalReply, tool: "" });
        break;
      }

      const choice = parsedResponse.choices[0];
      const assistantMessage = choice?.message;

      // Check if model called any tools
      const toolCalls = assistantMessage?.tool_calls;
      if (toolCalls && toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: assistantMessage.content ?? null,
          tool_calls: toolCalls,
        });

        for (const call of toolCalls) {
          const fnName = call.function?.name ?? "";
          const fnArgsStr = call.function?.arguments ?? "{}";
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(fnArgsStr) as Record<string, unknown>;
          } catch {
            parsedArgs = {};
          }

          yield* Effect.logInfo(
            `[ShoppingAssistant] Invoking tool '${fnName}' (callId: ${call.id}) for user '${userId}' with args: ${fnArgsStr}`,
          );

          chunks.push({
            type: "tool_start",
            tool: fnName,
            content: `Executing ${fnName}...`,
          });

          const toolDef = toolsMap.get(fnName);
          let toolResult = "";
          if (toolDef) {
            toolResult = yield* toolDef.execute(parsedArgs, { userId }).pipe(
              Effect.tap((res) =>
                Effect.logInfo(
                  `[ShoppingAssistant] Tool '${fnName}' completed (result length: ${res.length}): ${res.length > 500 ? res.slice(0, 500) + "..." : res}`,
                ),
              ),
              Effect.catch((err: unknown) =>
                Effect.logError(
                  `[ShoppingAssistant] Tool '${fnName}' failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
                ).pipe(
                  Effect.as(
                    safeJsonStringify({
                      error: `Tool execution failed: ${err}`,
                    }),
                  ),
                ),
              ),
            );
          } else {
            yield* Effect.logWarning(
              `[ShoppingAssistant] Tool '${fnName}' not recognized in available tools map`,
            );
            toolResult = safeJsonStringify({ error: `Tool ${fnName} not recognized.` });
          }

          chunks.push({
            type: "tool_result",
            tool: fnName,
            content: toolResult,
          });

          const record: ToolCallRecord = {
            id: call.id,
            toolName: fnName,
            arguments: fnArgsStr,
            result: toolResult,
          };
          accumulatedToolCalls.push(record);

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: toolResult,
          });
        }
        // Continue loop to let model process tool outputs
        continue;
      }

      // Final assistant response with no tool calls
      finalReply = assistantMessage?.content ?? "";
      chunks.push({ type: "text_delta", content: finalReply, tool: "" });
      break;
    }

    chunks.push({ type: "done", content: "", tool: "" });

    return {
      reply: finalReply,
      toolCallsUsed: accumulatedToolCalls,
      chunks,
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
}) {
  return Stream.fromEffect(executeChatTurn(options)).pipe(
    Stream.flatMap((result) => Stream.fromIterable(result.chunks)),
  );
}
