import { Cause, Effect, Queue, Redacted, Ref, Scope, Stream } from "effect";
import { Agent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonObject, JsonValue, ToolCall } from "@earendil-works/pi-ai";
import type { TSchema } from "@sinclair/typebox";
import { fixMojibake, mapLlmErrorToUserMessage } from "./error-formatter.js";
import {
  ChatChunk,
  ChatMessage,
  ChatMessageType,
  ChatResponse,
  LlmConfig,
  ResolvedLlmConfig,
  ToolCallRecord,
} from "./ai-schema.js";
import { getCurrentDatetimeIso } from "../common/index.js";
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

function parseToolArguments(raw: string): JsonObject {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
    return { value: parsed as JsonValue };
  } catch {
    return { raw };
  }
}

export function buildInitialAgentMessages(
  history: readonly ChatMessage[],
  resolvedModel: { api: string; provider: string; id: string },
): AgentMessage[] {
  const initialMessages: AgentMessage[] = [];

  for (const h of history) {
    if (h.role === "user") {
      initialMessages.push({
        role: "user",
        content: [{ type: "text", text: h.content }],
        timestamp: Date.now(),
      });
    } else if (h.role === "system") {
      initialMessages.push({
        role: "system",
        content: [{ type: "text", text: h.content }],
        timestamp: Date.now(),
      });
    } else if (h.role === "tool") {
      initialMessages.push({
        role: "toolResult",
        toolCallId: (h.toolCalls && h.toolCalls[0]?.id) ?? "tool-call-1",
        toolName: (h.toolCalls && h.toolCalls[0]?.toolName) ?? "tool",
        content: [{ type: "text", text: h.content }],
        isError: false,
        timestamp: Date.now(),
      });
    } else if (h.role === "assistant") {
      const toolCalls = h.toolCalls ?? [];
      if (toolCalls.length > 0) {
        // 1. Assistant message containing the tool calls
        initialMessages.push({
          role: "assistant",
          content: toolCalls.map((tc): ToolCall => ({
            type: "toolCall",
            id: tc.id,
            name: tc.toolName,
            arguments: parseToolArguments(tc.arguments),
          })),
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
          stopReason: "toolUse",
          timestamp: Date.now(),
        });

        // 2. Corresponding tool result messages for each tool call
        for (const tc of toolCalls) {
          initialMessages.push({
            role: "toolResult",
            toolCallId: tc.id,
            toolName: tc.toolName,
            content: [{ type: "text", text: tc.result ?? "" }],
            isError: false,
            timestamp: Date.now(),
          });
        }

        // 3. Final text response from the assistant if present
        if (h.content && h.content.trim().length > 0) {
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
      } else {
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
  }

  return initialMessages;
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
            Queue.offerUnsafe(queue, errorChunk(missingApiKeyMessage));
            Queue.offerUnsafe(queue, doneChunk(""));
            if (onTurnComplete) {
              yield* onTurnComplete({
                reply: missingApiKeyMessage,
                toolCallsUsed: [],
                chunks: [errorChunk(missingApiKeyMessage), doneChunk("")],
                type: "error" as ChatMessageType,
              }).pipe(Effect.ignore);
            }
            Queue.endUnsafe(queue);
            return;
          }

          const { models, resolvedModel } = setupModelsAndProvider({ apiKey, model, apiUrl });

          // Convert prior history to Pi AgentMessage[] format with full tool call and result reconstruction
          const initialMessages = buildInitialAgentMessages(history, resolvedModel);

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
            yield* Effect.logError(`AI upstream error: ${raw}`);
            finalReply = mapLlmErrorToUserMessage(raw);
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

export const resolveLlmConfig = (llm: LlmConfig): Effect.Effect<ResolvedLlmConfig> =>
  Effect.gen(function* () {
    const apiKey = Redacted.value(yield* llm.apiKey.get);
    const model = Redacted.value(yield* llm.model.get);
    const apiUrl = Redacted.value(yield* llm.apiUrl.get);
    return { apiKey, model, apiUrl };
  }).pipe(Effect.orDie);

export interface ExecuteConversationalTurnOptions<
  S extends { readonly messages: readonly ChatMessage[] },
> {
  readonly state: Ref.Ref<S>;
  readonly userMessage: string;
  readonly systemPrompt: string;
  readonly tools: readonly AgentTool<TSchema>[];
  readonly llm: LlmConfig;
  readonly missingApiKeyMessage?: string;
}

export function executeConversationalTurn<S extends { readonly messages: readonly ChatMessage[] }>(
  options: ExecuteConversationalTurnOptions<S>,
): Effect.Effect<ChatResponse, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { messages } = yield* Ref.get(options.state);
    const { apiKey, model, apiUrl } = yield* resolveLlmConfig(options.llm);

    const result = yield* executeAgentChatTurn({
      systemPrompt: options.systemPrompt,
      tools: options.tools,
      apiKey,
      model,
      apiUrl,
      history: messages,
      userMessage: options.userMessage,
      missingApiKeyMessage: options.missingApiKeyMessage,
    });

    const now = yield* getCurrentDatetimeIso;
    const userMsg: ChatMessage = {
      role: "user",
      content: options.userMessage,
      timestamp: now,
      type: "ok",
    };
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: result.reply,
      toolCalls: result.toolCallsUsed.length > 0 ? [...result.toolCallsUsed] : undefined,
      timestamp: now,
      type: result.type,
    };

    yield* Ref.update(options.state, (prev) => ({
      ...prev,
      messages: [...prev.messages, userMsg, assistantMsg],
    }));

    return {
      reply: result.reply,
      toolCallsUsed: [...result.toolCallsUsed],
      type: result.type,
    };
  }).pipe(Effect.orDie);
}

export function executeConversationalTurnStream<
  S extends { readonly messages: readonly ChatMessage[] },
>(options: ExecuteConversationalTurnOptions<S>): Stream.Stream<ChatChunk> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const { messages } = yield* Ref.get(options.state);
      const { apiKey, model, apiUrl } = yield* resolveLlmConfig(options.llm);

      return executeAgentChatTurnStream({
        systemPrompt: options.systemPrompt,
        tools: options.tools,
        apiKey,
        model,
        apiUrl,
        history: messages,
        userMessage: options.userMessage,
        missingApiKeyMessage: options.missingApiKeyMessage,
        onTurnComplete: (result) =>
          Effect.gen(function* () {
            const now = yield* getCurrentDatetimeIso;
            const userMsg: ChatMessage = {
              role: "user",
              content: options.userMessage,
              timestamp: now,
              type: "ok",
            };
            const assistantMsg: ChatMessage = {
              role: "assistant",
              content: result.reply,
              toolCalls: result.toolCallsUsed.length > 0 ? [...result.toolCallsUsed] : undefined,
              timestamp: now,
              type: result.type,
            };
            yield* Ref.update(options.state, (prev) => ({
              ...prev,
              messages: [...prev.messages, userMsg, assistantMsg],
            }));
          }),
      });
    }).pipe(Effect.orDie),
  );
}
