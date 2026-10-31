import { Schema } from "effect";
import { Datetime } from "@golemcloud/effect-golem";

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
  start: Schema.optional(Datetime.Datetime),
  end: Schema.optional(Datetime.Datetime),
});

export type SalePricingItem = typeof SalePricingItem.Type;

export const Pricing = Schema.Struct({
  productId: Schema.String,
  msrpPrices: Schema.Array(PricingItem),
  listPrices: Schema.Array(PricingItem),
  salePrices: Schema.Array(SalePricingItem),
  createdAt: Datetime.Datetime,
  updatedAt: Datetime.Datetime,
});

export type Pricing = typeof Pricing.Type;

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

const datetimeKey = (dt: Datetime.Datetime | undefined): string =>
  dt ? `${dt.seconds.toString()}-${dt.nanoseconds.toString()}` : "none";

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
