import { Effect, Layer, Schema } from "effect";
import { Tool } from "@golemcloud/effect-golem";
import { ProductSearchAgent, ProductWithPrice } from "../agents/product-search/index.js";

const getSearchClient = Effect.gen(function* () {
  const client = yield* ProductSearchAgent.client.newPhantom({}).pipe(Effect.orDie);
  return client;
});

export const catalogToolHandlers = {
  searchProducts: ({ query, currency }: { query: string; currency?: string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getSearchClient;
        const res = yield* client.searchWithPrices({ query, currency }).pipe(Effect.orDie);
        return res.value;
      }),
    ),
  getProductDetails: (input: { "product-id": string; currency?: string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getSearchClient;
        const productId = input["product-id"];
        const currency = input.currency;
        const res = yield* client
          .getByIdsWithPrices({ ids: productId, currency })
          .pipe(Effect.orDie);
        return res.value[0] ?? null;
      }),
    ),
};

export const catalogTools = Object.assign(
  Tool.toolDefinition("catalog-tools", {
    doc: "Store catalog tools for searching products and viewing item details",
  })
    .command("search-products", (cmd) =>
      cmd.body((b) =>
        b
          .option("query", Schema.String, { doc: "Search query string, keywords, or brand" })
          .option("currency", Schema.optional(Schema.String), {
            doc: "Optional currency code, e.g. USD, EUR",
          })
          .returns(Schema.Array(ProductWithPrice), {
            doc: "Matching products with current prices",
          }),
      ),
    )
    .command("get-product-details", (cmd) =>
      cmd.body((b) =>
        b
          .option("product-id", Schema.String, { doc: "Unique product identifier, e.g. 'ap001'" })
          .option("currency", Schema.optional(Schema.String), {
            doc: "Optional currency code, e.g. USD, EUR",
          })
          .returns(Schema.NullOr(ProductWithPrice), {
            doc: "Product details or null if not found",
          }),
      ),
    )
    .implement(catalogToolHandlers, Layer.empty),
  { handlers: catalogToolHandlers },
);
