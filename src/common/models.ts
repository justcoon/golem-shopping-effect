import { DateTime, Effect, Schema } from "effect";
import { Datetime } from "@golemcloud/effect-golem";

export const Address = Schema.Struct({
  street: Schema.String,
  city: Schema.String,
  stateOrRegion: Schema.String,
  country: Schema.String,
  postalCode: Schema.String,
  name: Schema.optional(Schema.String),
  phoneNumber: Schema.optional(Schema.String),
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

export const getCurrentDatetime: Effect.Effect<Datetime.Datetime> = Effect.gen(function* () {
  const now = yield* DateTime.now;
  return yield* Datetime.fromDateTime(now);
}).pipe(Effect.orDie);
