import { DateTime, Schema } from "effect";

export const PricingItem = Schema.Struct({
  price: Schema.Number,
  currency: Schema.String,
  region: Schema.String,
});

export type PricingItem = typeof PricingItem.Type;

export const SalePricingItem = Schema.Struct({
  price: Schema.Number,
  currency: Schema.String,
  region: Schema.String,
  start: Schema.optional(Schema.DateTimeUtcFromString),
  end: Schema.optional(Schema.DateTimeUtcFromString),
});

export type SalePricingItem = typeof SalePricingItem.Type;

export const Pricing = Schema.Struct({
  productId: Schema.String,
  msrpPrices: Schema.Array(PricingItem),
  listPrices: Schema.Array(PricingItem),
  salePrices: Schema.Array(SalePricingItem),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

export type Pricing = typeof Pricing.Type;

export const PricingAgentState = Schema.Struct({
  productId: Schema.String,
  pricing: Schema.NullOr(Pricing),
});
export type PricingAgentState = typeof PricingAgentState.Type;

export const mergePricingItems = (
  first: readonly PricingItem[],
  second: readonly PricingItem[],
): PricingItem[] => {
  const map = new Map<string, PricingItem>();
  for (const item of first) {
    map.set(`${item.currency}-${item.region}`, item);
  }
  for (const item of second) {
    map.set(`${item.currency}-${item.region}`, item);
  }
  return Array.from(map.values());
};

const datetimeKey = (dt: DateTime.Utc | undefined): string =>
  dt ? DateTime.formatIso(dt) : "none";

export const mergeSalePricingItems = (
  first: readonly SalePricingItem[],
  second: readonly SalePricingItem[],
): SalePricingItem[] => {
  const map = new Map<string, SalePricingItem>();

  for (const item of first) {
    const key = `${item.currency}-${item.region}-${datetimeKey(item.start)}-${datetimeKey(item.end)}`;
    map.set(key, item);
  }

  for (const item of second) {
    const key = `${item.currency}-${item.region}-${datetimeKey(item.start)}-${datetimeKey(item.end)}`;
    map.set(key, item);
  }

  return Array.from(map.values());
};
