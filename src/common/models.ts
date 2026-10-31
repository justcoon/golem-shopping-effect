import { DateTime, Effect, Schema } from "effect";

export const Address = Schema.Struct({
  street: Schema.String,
  city: Schema.String,
  stateOrRegion: Schema.String,
  country: Schema.String,
  postalCode: Schema.String,
  name: Schema.optional(Schema.String),
  phoneNumber: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
});

export type Address = typeof Address.Type;

export const CURRENCY = "USD";
export const PRICING_REGION_DEFAULT = "global";

export function arrayChunks<T>(array: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

export const getCurrentDatetime: Effect.Effect<DateTime.Utc> = DateTime.now;

/**
 * Safely stringifies objects containing BigInt values (e.g. Datetime.Datetime seconds)
 * by converting BigInt to string.
 */
export function safeJsonStringify(data: unknown, space?: string | number): string {
  return JSON.stringify(
    data,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    space,
  );
}
