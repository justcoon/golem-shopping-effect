import { Schema } from "effect";

export * from "../../ai/ai-schema.js";

export const RECOMMENDATION_INPUT_COUNT = 100;
export const RECOMMENDATION_PRODUCT_COUNT = 4;
export const RECOMMENDATION_BRAND_COUNT = 3;

export const RecommendedItems = Schema.Struct({
  productIds: Schema.Array(Schema.String),
  productBrands: Schema.Array(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

export type RecommendedItems = typeof RecommendedItems.Type;

export interface LLMRecommendations {
  productIds: string[];
  productBrands: string[];
}
