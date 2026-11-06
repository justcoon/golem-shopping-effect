import { Schema } from "effect";
import type { OrderItem } from "../order/order-schema.js";

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

export function cleanMarkdownJsonString(input: string): string {
  return input.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1").trim();
}

export function reduceOrderItems(items: readonly OrderItem[]): OrderItem[] {
  const itemMap = new Map<string, OrderItem>();

  for (const item of items) {
    const existing = itemMap.get(item.productId);
    if (existing) {
      itemMap.set(item.productId, {
        ...existing,
        quantity: existing.quantity + item.quantity,
      });
    } else {
      itemMap.set(item.productId, { ...item });
    }
  }

  return Array.from(itemMap.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, RECOMMENDATION_INPUT_COUNT);
}
