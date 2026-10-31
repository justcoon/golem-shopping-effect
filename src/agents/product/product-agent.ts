import { Effect, Ref, Schema } from "effect";
import { defineAgent, Http, method } from "@golemcloud/effect-golem";
import { getCurrentDatetime } from "../../common/index.js";
import { Product } from "./product-schema.js";

interface ProductAgentState {
  readonly productId: string;
  readonly product: Product | null;
}

export const ProductAgent = defineAgent({
  name: "ProductAgent",
  mode: "durable",
  id: { id: Schema.String },
  http: Http.mount("/v1/product/{id}"),
  methods: {
    initializeProduct: method({
      input: {
        name: Schema.String,
        brand: Schema.String,
        description: Schema.String,
        tags: Schema.Array(Schema.String),
      },
      success: Schema.Void,
      http: [Http.post("/")],
      description: "Initialize product",
    }),
    get: method({
      input: {},
      success: Schema.NullOr(Product),
      readOnly: true,
      http: [Http.get("/")],
      description: "Get product",
    }),
  },
}).implement({
  init: ({ id }) =>
    Ref.make<ProductAgentState>({
      productId: id,
      product: null,
    }),
  methods: (state) => ({
    initializeProduct: ({ name, brand, description, tags }) =>
      Effect.gen(function* () {
        const { productId } = yield* Ref.get(state);
        const date = yield* getCurrentDatetime;
        const product: Product = {
          productId,
          name,
          brand,
          description,
          tags,
          createdAt: date,
          updatedAt: date,
        };
        yield* Ref.update(state, (curr) => ({ ...curr, product }));
      }),
    get: () => Ref.get(state).pipe(Effect.map(({ product }) => product)),
  }),
});
