import { Effect, Layer, Schema } from "effect";
import { Tool } from "@golemcloud/effect-golem";
import { Cart, CartAgentDefinition } from "../agents/cart/index.js";

const getCartClient = (userId: string) =>
  CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);

export const cartTools = Tool.toolDefinition("cart-tools", {
  doc: "Customer shopping cart management tools for viewing and modifying items",
})
  .command("get-cart", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID" })
        .returns(Schema.NullOr(Cart), { doc: "Current shopping cart with items and total" }),
    ),
  )
  .command("add-to-cart", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID" })
        .option("product-id", Schema.String, { doc: "Product ID to add" })
        .option("quantity", Schema.Number, { doc: "Quantity to add" })
        .returns(Schema.NullOr(Cart), { doc: "Updated shopping cart" }),
    ),
  )
  .command("update-cart-quantity", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID" })
        .option("product-id", Schema.String, { doc: "Product ID to update" })
        .option("quantity", Schema.Number, { doc: "New absolute quantity" })
        .returns(Schema.NullOr(Cart), { doc: "Updated shopping cart" }),
    ),
  )
  .command("remove-from-cart", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID" })
        .option("product-id", Schema.String, { doc: "Product ID to remove" })
        .returns(Schema.NullOr(Cart), { doc: "Updated shopping cart" }),
    ),
  )
  .command("clear-cart", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID" })
        .returns(Schema.NullOr(Cart), { doc: "Cleared empty shopping cart" }),
    ),
  )
  .implement(
    {
      getCart: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getCartClient(input["user-id"]);
            return yield* client.get({}).pipe(Effect.orDie);
          }),
        ),
      addToCart: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getCartClient(input["user-id"]);
            yield* client
              .addItem({
                productId: input["product-id"],
                quantity: input.quantity,
              })
              .pipe(Effect.orDie);
            return yield* client.get({}).pipe(Effect.orDie);
          }),
        ),
      updateCartQuantity: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getCartClient(input["user-id"]);
            yield* client
              .updateItemQuantity({
                productId: input["product-id"],
                quantity: input.quantity,
              })
              .pipe(Effect.orDie);
            return yield* client.get({}).pipe(Effect.orDie);
          }),
        ),
      removeFromCart: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getCartClient(input["user-id"]);
            yield* client.removeItem({ productId: input["product-id"] }).pipe(Effect.orDie);
            return yield* client.get({}).pipe(Effect.orDie);
          }),
        ),
      clearCart: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getCartClient(input["user-id"]);
            yield* client.clear({}).pipe(Effect.orDie);
            return yield* client.get({}).pipe(Effect.orDie);
          }),
        ),
    },
    Layer.empty,
  );
