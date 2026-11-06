import { Cause, Effect, Queue, Stream } from "effect";
import { Agent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import { extractLlmErrorMessage, fixMojibake } from "./error-formatter.js";
import { ChatChunk, ChatMessage, ChatMessageType, ToolCallRecord } from "./ai-schema.js";
import { setupModelsAndProvider } from "./models-provider.js";

export interface ChatTurnResult {
  readonly reply: string;
  readonly toolCallsUsed: readonly ToolCallRecord[];
  readonly chunks: readonly ChatChunk[];
  readonly type: ChatMessageType;
}

function textDeltaChunk(content: string): ChatChunk {
  return { _tag: "text_delta", content };
}

function toolStartChunk(content: string, toolCall: ToolCallRecord): ChatChunk {
  return { _tag: "tool_start", content, toolCall };
}

function toolResultChunk(content: string, toolCall: ToolCallRecord): ChatChunk {
  return { _tag: "tool_result", content, toolCall };
}

function doneChunk(content = ""): ChatChunk {
  return { _tag: "done", content };
}

function errorChunk(content: string): ChatChunk {
  return { _tag: "error", content };
}

export interface ExecuteAgentChatTurnOptions {
  readonly systemPrompt: string;
  readonly tools: readonly AgentTool<TSchema>[];
  readonly apiKey: string;
  readonly model: string;
  readonly apiUrl?: string;
  readonly history: readonly ChatMessage[];
  readonly userMessage: string;
  readonly missingApiKeyMessage?: string;
}

export interface ExecuteAgentChatTurnStreamOptions extends ExecuteAgentChatTurnOptions {
  readonly onTurnComplete?: (result: ChatTurnResult) => Effect.Effect<void>;
}

export function executeAgentChatTurnStream(
  options: ExecuteAgentChatTurnStreamOptions,
): Stream.Stream<ChatChunk> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<ChatChunk, Cause.Done>();

      yield* Effect.forkScoped(
        Effect.gen(function* () {
          const {
            systemPrompt,
            tools,
            apiKey,
            model,
            apiUrl,
            history,
            userMessage,
            missingApiKeyMessage = "AI agent is ready, but no LLM API key is configured. Please provide GEMINI_API_KEY or OPENROUTER_KEY in your environment or secrets.",
            onTurnComplete,
          } = options;

          if (!apiKey) {
            Queue.offerUnsafe(queue, textDeltaChunk(missingApiKeyMessage));
            Queue.offerUnsafe(queue, errorChunk(missingApiKeyMessage));
            Queue.offerUnsafe(queue, doneChunk(""));
            if (onTurnComplete) {
              yield* onTurnComplete({
                reply: missingApiKeyMessage,
                toolCallsUsed: [],
                chunks: [
                  textDeltaChunk(missingApiKeyMessage),
                  errorChunk(missingApiKeyMessage),
                  doneChunk(""),
                ],
                type: "error" as ChatMessageType,
              }).pipe(Effect.ignore);
            }
            Queue.endUnsafe(queue);
            return;
          }

          const { models, resolvedModel } = setupModelsAndProvider({ apiKey, model, apiUrl });

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

          const emitChunk = (chunk: ChatChunk) => {
            chunks.push(chunk);
            Queue.offerUnsafe(queue, chunk);
          };

          const agent = new Agent({
            initialState: {
              systemPrompt,
              model: resolvedModel,
              tools: tools as unknown as AgentTool[],
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
                emitChunk(
                  toolStartChunk(`Executing ${event.toolName}...`, {
                    id: event.toolCallId,
                    toolName: event.toolName,
                    arguments: argsString,
                    result: "",
                  }),
                );
                break;
              }
              case "tool_execution_end": {
                const summary =
                  event.result?.details?.summary ?? (event.isError ? "Failed" : "Completed");
                const resultString =
                  event.result?.details?.resultString ?? JSON.stringify(event.result ?? {});
                const rawArgs = (toolArgsById.get(event.toolCallId) as string) ?? "";
                const toolCall: ToolCallRecord = {
                  id: event.toolCallId,
                  toolName: event.toolName,
                  arguments: rawArgs,
                  result: resultString,
                };
                emitChunk(toolResultChunk(summary, toolCall));
                accumulatedToolCalls.push(toolCall);
                break;
              }
              case "message_update": {
                const update = event.assistantMessageEvent;
                if (update.type === "text_delta" && update.delta) {
                  emitChunk(textDeltaChunk(update.delta));
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
            emitChunk(textDeltaChunk(finalReply));
            emitChunk(errorChunk(finalReply));
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
            if (chunks.length === 0 || !chunks.some((c) => c._tag === "text_delta")) {
              emitChunk(textDeltaChunk(finalReply));
            }
          }

          emitChunk(doneChunk(""));

          const result: ChatTurnResult = {
            reply: finalReply,
            toolCallsUsed: accumulatedToolCalls,
            chunks,
            type: (isError ? "error" : "ok") as ChatMessageType,
          };

          if (onTurnComplete) {
            yield* onTurnComplete(result).pipe(Effect.ignore);
          }

          Queue.endUnsafe(queue);
        }).pipe(
          Effect.catchCause(() =>
            Effect.sync(() => {
              Queue.offerUnsafe(
                queue,
                errorChunk("Unexpected error during agent stream execution"),
              );
              Queue.offerUnsafe(queue, doneChunk(""));
              Queue.endUnsafe(queue);
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              Queue.endUnsafe(queue);
            }),
          ),
        ),
      );

      return Stream.fromQueue(queue);
    }),
  );
}

export function executeAgentChatTurn(
  options: ExecuteAgentChatTurnOptions,
): Effect.Effect<ChatTurnResult> {
  return Effect.gen(function* () {
    let result: ChatTurnResult | undefined;

    const stream = executeAgentChatTurnStream({
      ...options,
      onTurnComplete: (res) =>
        Effect.sync(() => {
          result = res;
        }),
    });

    yield* Stream.runDrain(stream);

    if (!result) {
      return yield* Effect.die("Agent turn completed without producing a result");
    }

    return result;
  });
}
