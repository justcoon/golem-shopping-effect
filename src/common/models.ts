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
export const INVENTORY_REGION_DEFAULT = "global";
export const CHECKOUT_RESERVATION_TTL_SECONDS = 600;

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

/**
 * Converts an Effect Schema into standard JSON Schema format for function-calling LLMs.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function schemaToJsonSchema(schema: Schema.Schema<any>): Record<string, unknown> {
  const std = Schema.toStandardJSONSchemaV1(schema);
  const doc = std["~standard"].jsonSchema.input({ target: "draft-07" }) as Record<string, unknown>;
  if (doc && doc.type === "object") {
    return doc;
  }
  // For empty structs (Schema.Struct({})), Standard Schema emits `{ not: { type: 'null' } }`,
  // but OpenAI/Gemini tool calling APIs strictly require `{ type: 'object', properties: {} }`.
  return {
    type: "object",
    properties: {},
  };
}

/**
 * Converts agent RPC transport failures (RemoteCallError) into defects while preserving domain errors.
 */
export const orDieRpc = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
  eff.pipe(
    Effect.catchTags({
      RpcCallError: Effect.die,
      InvalidUuidError: Effect.die,
      RemoteResponseError: Effect.die,
      ScopeCardUnavailableError: Effect.die,
    }),
  );
