import { Effect } from "effect";
import { CartAgentDefinition } from "../cart/index.js";
import { OrderAgent } from "../order/index.js";
import { ProductSearchAgent } from "../product-search/index.js";
import {
  AssistantToolSpec,
  shoppingAssistantToolSpecs,
  summarizeToolResult,
} from "./shopping-assistant-tool-specs.js";

export { summarizeToolResult };

export interface ToolContext {
  readonly userId: string;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return fallback;
}

export interface AssistantToolDefinition<T = unknown> extends AssistantToolSpec<T> {
  readonly execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Effect.Effect<T, never, any>;
}

type ToolExecutor = (
  args: Record<string, unknown>,
  ctx: ToolContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Effect.Effect<unknown, never, any>;

const toolExecutors: Record<string, ToolExecutor> = {
  search_products: (args: Record<string, unknown>, _ctx: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const query = String(args["query"] ?? "");
        const currency = args["currency"] ? String(args["currency"]) : undefined;
        yield* Effect.logInfo(
          `[search_products] query="${query}" currency=${currency ?? "default"}`,
        );
        const client = yield* ProductSearchAgent.client.newPhantom({}).pipe(Effect.orDie);
        const { value: results } = yield* client
          .searchWithPrices({ query, currency })
          .pipe(Effect.orDie);
        yield* Effect.logInfo(`[search_products] returned ${results.length} products`);
        return results;
      }),
    ),

  get_product_details: (args: Record<string, unknown>, _ctx: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const productId = String(args["productId"] ?? "");
        const currency = args["currency"] ? String(args["currency"]) : undefined;
        yield* Effect.logInfo(
          `[get_product_details] productId="${productId}" currency=${currency ?? "default"}`,
        );
        const client = yield* ProductSearchAgent.client.newPhantom({}).pipe(Effect.orDie);
        const { value: results } = yield* client
          .getByIdsWithPrices({ ids: productId, currency })
          .pipe(Effect.orDie);
        if (results.length === 0) {
          yield* Effect.logWarning(`[get_product_details] product not found: ${productId}`);
          return { error: `Product with ID ${productId} not found.` };
        }
        yield* Effect.logInfo(`[get_product_details] found product: "${results[0]?.name}"`);
        return results[0];
      }),
    ),

  get_cart: (_args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.logInfo(`[get_cart] fetching cart for userId="${userId}"`);
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        const cart = yield* client.get({}).pipe(Effect.orDie);
        yield* Effect.logInfo(
          `[get_cart] userId="${userId}" cart item count: ${cart?.items.length ?? 0}, total: ${cart?.total ?? 0}`,
        );
        return (
          cart ?? {
            userId,
            items: [],
            total: 0,
            message: "Cart is currently empty.",
          }
        );
      }),
    ),

  add_to_cart: (args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const productId = String(args["productId"] ?? "");
        const quantity = Number(args["quantity"] ?? 1);
        yield* Effect.logInfo(
          `[add_to_cart] adding productId="${productId}" qty=${quantity} for userId="${userId}"`,
        );
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.addItem({ productId, quantity }).pipe(
          Effect.tap(() =>
            Effect.logInfo(`[add_to_cart] successfully added productId="${productId}"`),
          ),
          Effect.map((res) => ({ success: true, ...res })),
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Failed to add item to cart.");
            return Effect.logWarning(`[add_to_cart] failed: ${msg}`).pipe(
              Effect.as({
                success: false,
                error: msg,
              }),
            );
          }),
        );
      }),
    ),

  update_cart_quantity: (args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const productId = String(args["productId"] ?? "");
        const quantity = Number(args["quantity"] ?? 1);
        yield* Effect.logInfo(
          `[update_cart_quantity] updating productId="${productId}" to qty=${quantity} for userId="${userId}"`,
        );
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.updateItemQuantity({ productId, quantity }).pipe(
          Effect.tap(() =>
            Effect.logInfo(`[update_cart_quantity] successfully updated productId="${productId}"`),
          ),
          Effect.map((res) => ({ success: true, ...res })),
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Failed to update item quantity.");
            return Effect.logWarning(`[update_cart_quantity] failed: ${msg}`).pipe(
              Effect.as({
                success: false,
                error: msg,
              }),
            );
          }),
        );
      }),
    ),

  remove_from_cart: (args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const productId = String(args["productId"] ?? "");
        yield* Effect.logInfo(
          `[remove_from_cart] removing productId="${productId}" for userId="${userId}"`,
        );
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.removeItem({ productId }).pipe(
          Effect.tap(() =>
            Effect.logInfo(`[remove_from_cart] successfully removed productId="${productId}"`),
          ),
          Effect.map((res) => ({ success: true, ...res })),
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Failed to remove item from cart.");
            return Effect.logWarning(`[remove_from_cart] failed: ${msg}`).pipe(
              Effect.as({
                success: false,
                error: msg,
              }),
            );
          }),
        );
      }),
    ),

  clear_cart: (_args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.logInfo(`[clear_cart] clearing cart for userId="${userId}"`);
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        yield* client.clear({}).pipe(Effect.orDie);
        yield* Effect.logInfo(`[clear_cart] cart cleared for userId="${userId}"`);
        return { success: true, message: "Cart cleared successfully." };
      }),
    ),

  get_saved_contact_info: (_args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.logInfo(
          `[get_saved_contact_info] fetching saved info for userId="${userId}"`,
        );
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        const info = yield* client.getSavedContactInfo({}).pipe(Effect.orDie);
        yield* Effect.logInfo(
          `[get_saved_contact_info] result for userId="${userId}": found=${info ? "true" : "false"}`,
        );
        return (
          info ?? {
            found: false,
            message: "No saved contact info found from prior orders.",
          }
        );
      }),
    ),

  apply_saved_contact_info: (_args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.logInfo(
          `[apply_saved_contact_info] applying saved contact info for userId="${userId}"`,
        );
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.applySavedContactInfo({}).pipe(
          Effect.tap(() =>
            Effect.logInfo(
              `[apply_saved_contact_info] successfully applied for userId="${userId}"`,
            ),
          ),
          Effect.map((res) => ({ success: true, ...res })),
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Failed to apply saved contact info.");
            return Effect.logWarning(`[apply_saved_contact_info] failed: ${msg}`).pipe(
              Effect.as({
                success: false,
                error: msg,
              }),
            );
          }),
        );
      }),
    ),

  set_shipping_address: (args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.logInfo(
          `[set_shipping_address] updating shipping address for userId="${userId}"`,
        );
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client
          .updateShippingAddress({
            street: String(args["street"] ?? ""),
            city: String(args["city"] ?? ""),
            stateOrRegion: String(args["stateOrRegion"] ?? ""),
            country: String(args["country"] ?? ""),
            postalCode: String(args["postalCode"] ?? ""),
            name: args["name"] ? String(args["name"]) : undefined,
            phoneNumber: args["phoneNumber"] ? String(args["phoneNumber"]) : undefined,
            email: args["email"] ? String(args["email"]) : undefined,
          })
          .pipe(
            Effect.tap(() =>
              Effect.logInfo(
                `[set_shipping_address] shipping address updated for userId="${userId}"`,
              ),
            ),
            Effect.map((res) => ({ success: true, ...res })),
            Effect.catch((err: unknown) => {
              const msg = extractErrorMessage(err, "Failed to update shipping address.");
              return Effect.logWarning(`[set_shipping_address] failed: ${msg}`).pipe(
                Effect.as({
                  success: false,
                  error: msg,
                }),
              );
            }),
          );
      }),
    ),

  set_billing_address: (args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.logInfo(
          `[set_billing_address] updating billing address for userId="${userId}"`,
        );
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client
          .updateBillingAddress({
            street: String(args["street"] ?? ""),
            city: String(args["city"] ?? ""),
            stateOrRegion: String(args["stateOrRegion"] ?? ""),
            country: String(args["country"] ?? ""),
            postalCode: String(args["postalCode"] ?? ""),
            name: args["name"] ? String(args["name"]) : undefined,
            phoneNumber: args["phoneNumber"] ? String(args["phoneNumber"]) : undefined,
            email: args["email"] ? String(args["email"]) : undefined,
          })
          .pipe(
            Effect.tap(() =>
              Effect.logInfo(
                `[set_billing_address] billing address updated for userId="${userId}"`,
              ),
            ),
            Effect.map((res) => ({ success: true, ...res })),
            Effect.catch((err: unknown) => {
              const msg = extractErrorMessage(err, "Failed to update billing address.");
              return Effect.logWarning(`[set_billing_address] failed: ${msg}`).pipe(
                Effect.as({
                  success: false,
                  error: msg,
                }),
              );
            }),
          );
      }),
    ),

  set_email: (args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const email = String(args["email"] ?? "");
        yield* Effect.logInfo(`[set_email] updating email="${email}" for userId="${userId}"`);
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.updateEmail({ email }).pipe(
          Effect.tap(() =>
            Effect.logInfo(`[set_email] email updated successfully for userId="${userId}"`),
          ),
          Effect.map((res) => ({ success: true, ...res })),
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Failed to update email.");
            return Effect.logWarning(`[set_email] failed: ${msg}`).pipe(
              Effect.as({
                success: false,
                error: msg,
              }),
            );
          }),
        );
      }),
    ),

  checkout_cart: (_args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.logInfo(`[checkout_cart] initiating checkout for userId="${userId}"`);
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.checkout({}).pipe(
          Effect.tap((confirmation) =>
            Effect.logInfo(
              `[checkout_cart] checkout completed! orderId="${confirmation.orderId}" userId="${confirmation.userId}"`,
            ),
          ),
          Effect.map((confirmation) => ({
            success: true,
            orderId: confirmation.orderId,
            userId: confirmation.userId,
          })),
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Checkout failed.");
            const tag =
              typeof err === "object" && err !== null && "_tag" in err
                ? String((err as { _tag: unknown })._tag)
                : undefined;
            return Effect.logWarning(
              `[checkout_cart] checkout failed for userId="${userId}": ${msg} (tag: ${tag})`,
            ).pipe(
              Effect.as({
                success: false,
                error: msg,
                tag,
              }),
            );
          }),
        );
      }),
    ),

  get_order_history: (args: Record<string, unknown>, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const limit = args["limit"] ? Number(args["limit"]) : undefined;
        yield* Effect.logInfo(
          `[get_order_history] fetching orders (limit=${limit ?? "default"}) for userId="${userId}"`,
        );
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        const orders = yield* client.getOrderHistory({ limit }).pipe(Effect.orDie);
        yield* Effect.logInfo(
          `[get_order_history] found ${orders.length} orders for userId="${userId}"`,
        );
        return orders;
      }),
    ),

  get_order_details: (args: Record<string, unknown>, _ctx: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const orderId = String(args["orderId"] ?? "");
        yield* Effect.logInfo(`[get_order_details] fetching orderId="${orderId}"`);
        const client = yield* OrderAgent.client.get({ id: orderId }).pipe(Effect.orDie);
        const order = yield* client.get({}).pipe(Effect.orDie);
        if (order) {
          yield* Effect.logInfo(
            `[get_order_details] found orderId="${orderId}", status="${order.orderStatus}", total=${order.total}`,
          );
        } else {
          yield* Effect.logWarning(`[get_order_details] orderId="${orderId}" not found`);
        }
        return order ?? { error: `Order with ID ${orderId} not found.` };
      }),
    ),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAssistantToolDefinition = AssistantToolDefinition<any>;

export const shoppingAssistantTools: readonly AnyAssistantToolDefinition[] =
  shoppingAssistantToolSpecs.map((spec) => ({
    ...spec,
    execute:
      toolExecutors[spec.name] ??
      (() => Effect.succeed({ error: `Tool ${spec.name} not implemented.` })),
  }));

export const toolsMap = new Map<string, AnyAssistantToolDefinition>(
  shoppingAssistantTools.map((t) => [t.name, t]),
);

export const toolsOpenAiFormat = shoppingAssistantTools.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));
