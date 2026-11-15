import { Effect, Layer, Schema } from "effect";
import { Tool } from "@golemcloud/effect-golem";
import {
  Cart,
  CartAgentDefinition,
  CartUpdated,
  OrderConfirmation,
  SavedContactInfo,
} from "../agents/cart/index.js";

const getCartClient = (userId: string) =>
  CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);

export const cartToolHandlers = {
  getCart: (input: { "user-id": string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        return yield* client.get({}).pipe(Effect.orDie);
      }),
    ),
  addToCart: (input: { "user-id": string; "product-id": string; quantity?: number | null }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        yield* client
          .addItem({
            productId: input["product-id"],
            quantity: input.quantity ?? 1,
          })
          .pipe(Effect.orDie);
        return yield* client.get({}).pipe(Effect.orDie);
      }),
    ),
  updateCartQuantity: (input: { "user-id": string; "product-id": string; quantity: number }) =>
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
  removeFromCart: (input: { "user-id": string; "product-id": string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        yield* client.removeItem({ productId: input["product-id"] }).pipe(Effect.orDie);
        return yield* client.get({}).pipe(Effect.orDie);
      }),
    ),
  clearCart: (input: { "user-id": string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        yield* client.clear({}).pipe(Effect.orDie);
        return yield* client.get({}).pipe(Effect.orDie);
      }),
    ),
  getSavedContactInfo: (input: { "user-id": string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        return yield* client.getSavedContactInfo({}).pipe(Effect.orDie);
      }),
    ),
  applySavedContactInfo: (input: { "user-id": string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        return yield* client.applySavedContactInfo({}).pipe(Effect.orDie);
      }),
    ),
  setShippingAddress: (input: {
    "user-id": string;
    street: string;
    city: string;
    "state-or-region": string;
    country: string;
    "postal-code": string;
    name?: string | null;
    "phone-number"?: string | null;
    email?: string | null;
  }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        return yield* client
          .updateShippingAddress({
            street: input.street,
            city: input.city,
            stateOrRegion: input["state-or-region"],
            country: input.country,
            postalCode: input["postal-code"],
            name: input.name ?? undefined,
            phoneNumber: input["phone-number"] ?? undefined,
            email: input.email ?? undefined,
          })
          .pipe(Effect.orDie);
      }),
    ),
  setBillingAddress: (input: {
    "user-id": string;
    street: string;
    city: string;
    "state-or-region": string;
    country: string;
    "postal-code": string;
    name?: string | null;
    "phone-number"?: string | null;
    email?: string | null;
  }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        return yield* client
          .updateBillingAddress({
            street: input.street,
            city: input.city,
            stateOrRegion: input["state-or-region"],
            country: input.country,
            postalCode: input["postal-code"],
            name: input.name ?? undefined,
            phoneNumber: input["phone-number"] ?? undefined,
            email: input.email ?? undefined,
          })
          .pipe(Effect.orDie);
      }),
    ),
  setEmail: (input: { "user-id": string; email: string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        return yield* client.updateEmail({ email: input.email }).pipe(Effect.orDie);
      }),
    ),
  prepareCheckout: (input: { "user-id": string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        return yield* client.prepareCheckout({}).pipe(Effect.orDie);
      }),
    ),
  confirmCheckout: (input: { "user-id": string; "order-id": string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        return yield* client.confirmCheckout({ orderId: input["order-id"] }).pipe(Effect.orDie);
      }),
    ),
  cancelCheckout: (input: { "user-id": string; "order-id": string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getCartClient(input["user-id"]);
        return yield* client.cancelCheckout({ orderId: input["order-id"] }).pipe(Effect.orDie);
      }),
    ),
};

export const cartToolDefinition = Tool.toolDefinition("cart-tools", {
  doc: "Customer shopping cart management tools for viewing and modifying items",
})
  .command("get-cart", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .returns(Schema.NullOr(Cart), { doc: "Current shopping cart with items and total" }),
    ),
  )
  .command("add-to-cart", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .option("product-id", Schema.String, { doc: "Product ID to add", required: true })
        .option("quantity", Schema.Number, { doc: "Quantity to add" })
        .returns(Schema.NullOr(Cart), { doc: "Updated shopping cart" }),
    ),
  )
  .command("update-cart-quantity", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .option("product-id", Schema.String, { doc: "Product ID to update", required: true })
        .option("quantity", Schema.Number, { doc: "New absolute quantity", required: true })
        .returns(Schema.NullOr(Cart), { doc: "Updated shopping cart" }),
    ),
  )
  .command("remove-from-cart", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .option("product-id", Schema.String, { doc: "Product ID to remove", required: true })
        .returns(Schema.NullOr(Cart), { doc: "Updated shopping cart" }),
    ),
  )
  .command("clear-cart", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .returns(Schema.NullOr(Cart), { doc: "Cleared empty shopping cart" }),
    ),
  )
  .command("get-saved-contact-info", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .returns(Schema.NullOr(SavedContactInfo), {
          doc: "Previously saved contact and delivery details from past orders",
        }),
    ),
  )
  .command("apply-saved-contact-info", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .returns(Schema.NullOr(CartUpdated), {
          doc: "Updated cart with saved contact details applied",
        }),
    ),
  )
  .command("set-shipping-address", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .option("street", Schema.String, { doc: "Street address", required: true })
        .option("city", Schema.String, { doc: "City", required: true })
        .option("state-or-region", Schema.String, { doc: "State or region", required: true })
        .option("country", Schema.String, { doc: "Country", required: true })
        .option("postal-code", Schema.String, { doc: "Postal or ZIP code", required: true })
        .option("name", Schema.String, { doc: "Recipient full name" })
        .option("phone-number", Schema.String, { doc: "Contact phone number" })
        .option("email", Schema.String, { doc: "Contact email" })
        .returns(Schema.NullOr(CartUpdated), { doc: "Updated cart confirmation" }),
    ),
  )
  .command("set-billing-address", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .option("street", Schema.String, { doc: "Street address", required: true })
        .option("city", Schema.String, { doc: "City", required: true })
        .option("state-or-region", Schema.String, { doc: "State or region", required: true })
        .option("country", Schema.String, { doc: "Country", required: true })
        .option("postal-code", Schema.String, { doc: "Postal or ZIP code", required: true })
        .option("name", Schema.String, { doc: "Billing full name" })
        .option("phone-number", Schema.String, { doc: "Contact phone number" })
        .option("email", Schema.String, { doc: "Contact email" })
        .returns(Schema.NullOr(CartUpdated), { doc: "Updated cart confirmation" }),
    ),
  )
  .command("set-email", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .option("email", Schema.String, { doc: "Customer email address", required: true })
        .returns(Schema.NullOr(CartUpdated), { doc: "Updated cart confirmation" }),
    ),
  )
  .command("prepare-checkout", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .returns(Schema.NullOr(Cart), {
          doc: "Cart with reserved inventory draft and order ID",
        }),
    ),
  )
  .command("confirm-checkout", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .option("order-id", Schema.String, {
          doc: "Draft order ID to confirm and place",
          required: true,
        })
        .returns(Schema.NullOr(OrderConfirmation), { doc: "Placed order confirmation" }),
    ),
  )
  .command("cancel-checkout", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .option("order-id", Schema.String, {
          doc: "Active draft order ID to cancel and release stock",
          required: true,
        })
        .returns(Schema.Void, { doc: "Cancellation confirmation" }),
    ),
  );

// Register provider implementation with Golem runtime
cartToolDefinition.implement(cartToolHandlers, Layer.empty);

export const cartTools = Object.assign(cartToolDefinition, {
  handlers: cartToolHandlers,
});
