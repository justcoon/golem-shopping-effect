import { type Config } from "@golemcloud/effect-golem";
import { Schema } from "effect";

export const LlmConfigSchema = Schema.Struct({
  apiKey: Schema.Redacted(Schema.String),
  model: Schema.Redacted(Schema.String),
  apiUrl: Schema.Redacted(Schema.String),
});
export type LlmConfig = Config.ConfigShape<typeof LlmConfigSchema.fields>;

export interface ResolvedLlmConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly apiUrl?: string;
}

export const ChatRole = Schema.Union([
  Schema.Literal("system"),
  Schema.Literal("user"),
  Schema.Literal("assistant"),
  Schema.Literal("tool"),
]);
export type ChatRole = typeof ChatRole.Type;

export const ToolCallRecord = Schema.Struct({
  id: Schema.String,
  toolName: Schema.String,
  arguments: Schema.String,
  result: Schema.String,
});
export type ToolCallRecord = typeof ToolCallRecord.Type;

export const ChatMessageType = Schema.Union([Schema.Literal("ok"), Schema.Literal("error")]);
export type ChatMessageType = typeof ChatMessageType.Type;

export const ChatMessage = Schema.Struct({
  role: ChatRole,
  content: Schema.String,
  toolCalls: Schema.optional(Schema.Array(ToolCallRecord)),
  timestamp: Schema.String,
  type: Schema.optional(ChatMessageType),
});
export type ChatMessage = typeof ChatMessage.Type;

export const TextDeltaChunk = Schema.TaggedStruct("text_delta", {
  content: Schema.String,
});
export type TextDeltaChunk = typeof TextDeltaChunk.Type;

export const ToolStartChunk = Schema.TaggedStruct("tool_start", {
  content: Schema.String,
  toolCall: ToolCallRecord,
});
export type ToolStartChunk = typeof ToolStartChunk.Type;

export const ToolResultChunk = Schema.TaggedStruct("tool_result", {
  content: Schema.String,
  toolCall: ToolCallRecord,
});
export type ToolResultChunk = typeof ToolResultChunk.Type;

export const DoneChunk = Schema.TaggedStruct("done", {
  content: Schema.String,
});
export type DoneChunk = typeof DoneChunk.Type;

export const ErrorChunk = Schema.TaggedStruct("error", {
  content: Schema.String,
});
export type ErrorChunk = typeof ErrorChunk.Type;

export const ChatChunk = Schema.Union([
  TextDeltaChunk,
  ToolStartChunk,
  ToolResultChunk,
  DoneChunk,
  ErrorChunk,
]);
export type ChatChunk = typeof ChatChunk.Type;

export const ChatRequest = Schema.Struct({
  message: Schema.String,
});
export type ChatRequest = typeof ChatRequest.Type;

export const ChatResponse = Schema.Struct({
  reply: Schema.String,
  toolCallsUsed: Schema.Array(ToolCallRecord),
  type: Schema.optional(ChatMessageType),
});
export type ChatResponse = typeof ChatResponse.Type;
