import { Schema } from "effect";
import { Datetime } from "@golemcloud/effect-golem";

export const RECOMMENDATION_INPUT_COUNT = 100;
export const RECOMMENDATION_PRODUCT_COUNT = 4;
export const RECOMMENDATION_BRAND_COUNT = 3;

export const RecommendedItems = Schema.Struct({
  productIds: Schema.Array(Schema.String),
  productBrands: Schema.Array(Schema.String),
  createdAt: Datetime.Datetime,
  updatedAt: Datetime.Datetime,
});

export type RecommendedItems = typeof RecommendedItems.Type;

export interface LLMRecommendations {
  productIds: string[];
  productBrands: string[];
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

export const ChatMessage = Schema.Struct({
  role: ChatRole,
  content: Schema.String,
  toolCalls: Schema.optional(Schema.Array(ToolCallRecord)),
  timestamp: Schema.String,
});
export type ChatMessage = typeof ChatMessage.Type;

export const ChatChunkType = Schema.Union([
  Schema.Literal("tool_start"),
  Schema.Literal("tool_result"),
  Schema.Literal("text_delta"),
  Schema.Literal("done"),
  Schema.Literal("error"),
]);
export type ChatChunkType = typeof ChatChunkType.Type;

export const ChatChunk = Schema.Struct({
  type: ChatChunkType,
  content: Schema.String,
  tool: Schema.String,
});
export type ChatChunk = typeof ChatChunk.Type;

export const ChatRequest = Schema.Struct({
  message: Schema.String,
});
export type ChatRequest = typeof ChatRequest.Type;

export const ChatResponse = Schema.Struct({
  reply: Schema.String,
  toolCallsUsed: Schema.Array(ToolCallRecord),
});
export type ChatResponse = typeof ChatResponse.Type;
