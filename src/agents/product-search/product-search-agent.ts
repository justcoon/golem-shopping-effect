import { Chunk, Effect, Schema, Stream } from "effect";
import { Agents, defineAgent, Http, method } from "@golemcloud/effect-golem";
import { arrayChunks } from "../../common/index.js";
import { Product, ProductAgent } from "../product/index.js";
import { ProductQueryMatcher } from "./product-query-matcher.js";

function getProductAgentId(agentName: string): string | undefined {
  const match = agentName.match(/^ProductAgent\("([^"]+)"\)$/);
  return match ? match[1] : undefined;
}

export const ProductSearchAgent = defineAgent({
  name: "ProductSearchAgent",
  mode: "ephemeral",
  id: {},
  http: Http.mount("/v1/product"),
  methods: {
    getByIds: method({
      input: { ids: Schema.String },
      success: Schema.Array(Product),
      readOnly: true,
      http: [Http.get("/?ids={ids}")],
      description: "Get products by ids",
    }),
    search: method({
      input: { query: Schema.String },
      success: Schema.Array(Product),
      readOnly: true,
      http: [Http.get("/search?query={query}")],
      description: "Search products",
    }),
  },
}).implement({
  init: () => Effect.void,
  methods: () => ({
    getByIds: ({ ids }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const productIds = ids
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id.length > 0);

          yield* Effect.logInfo(`Get products - ids: (${productIds.join(",")})`);
          const result: Product[] = [];

          if (productIds.length > 0) {
            const idChunks = arrayChunks(productIds, 5);
            for (const chunk of idChunks) {
              const productEffects = chunk.map((id) =>
                Effect.gen(function* () {
                  const client = yield* ProductAgent.client.get({ id }).pipe(Effect.orDie);
                  return yield* client.get({}).pipe(Effect.orDie);
                }),
              );

              const products = yield* Effect.all(productEffects, {
                concurrency: "unbounded",
              });
              for (const product of products) {
                if (product) {
                  result.push(product);
                }
              }
            }
          }

          return result;
        }),
      ),

    search: ({ query }) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.logInfo(`Search products - query: ${query}`);

          const componentId = yield* Agents.resolveComponentId(
            "golem-shopping-effect:effect-main",
          ).pipe(
            Effect.catch(() =>
              Agents.getSelfMetadata.pipe(
                Effect.map((meta) => meta.agentId.componentId),
                Effect.catch(() => Effect.succeed(undefined)),
              ),
            ),
          );

          if (!componentId) {
            yield* Effect.logWarning("ProductSearchAgent: ComponentId could not be resolved");
            return [];
          }

          const matcher = new ProductQueryMatcher(query);
          const result: Product[] = [];
          const processedIds = new Set<string>();

          const filter = Agents.Filter.name("starts-with", "ProductAgent(");
          const agentMetadataStream = Agents.getAgents({
            componentId,
            filter,
            precise: true,
          });

          const agentMetadataChunk = yield* Stream.runCollect(agentMetadataStream).pipe(
            Effect.catch((err) =>
              Effect.logWarning(`Failed to stream agents: ${err}`).pipe(Effect.as(Chunk.empty())),
            ),
          );

          const ids: string[] = [];
          for (const meta of agentMetadataChunk) {
            const rawName = meta.agentId.agentId;
            const pid = getProductAgentId(rawName);
            if (pid && !processedIds.has(pid)) {
              processedIds.add(pid);
              ids.push(pid);
            }
          }

          if (ids.length > 0) {
            const idChunks = arrayChunks(ids, 5);
            for (const chunk of idChunks) {
              const fetchEffects = chunk.map((id) =>
                Effect.gen(function* () {
                  const client = yield* ProductAgent.client.get({ id }).pipe(Effect.orDie);
                  return yield* client.get({}).pipe(Effect.orDie);
                }),
              );

              const products = yield* Effect.all(fetchEffects, {
                concurrency: "unbounded",
              });
              for (const product of products) {
                if (product && matcher.matches(product)) {
                  result.push(product);
                }
              }
            }
          }

          return result;
        }),
      ),
  }),
});
