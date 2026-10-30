import { Effect } from "effect";
import { safeJsonStringify } from "../../common/index.js";
import { CartAgentDefinition } from "../cart/index.js";
import { OrderAgent } from "../order/index.js";
import { ProductSearchAgent } from "../product-search/index.js";
import { AssistantToolSpec, summarizeToolResult } from "./shopping-assistant-tool-specs.js";

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

export interface AssistantToolDefinition extends AssistantToolSpec {
  readonly execute: (
    args: Record<string, unknown>,
    ctx: ToolContext,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Effect.Effect<string, never, any>;
}

export const shoppingAssistantTools: readonly AssistantToolDefinition[] = [
  {
    name: "search_products",
    description:
      "Search catalog for products matching a query (by keyword, brand, or tag) and return products with live pricing.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query keyword, e.g. 'earbuds', 'brand:Apple', or 'tag:flagship'",
        },
        currency: {
          type: "string",
          description: "Optional currency code (e.g. 'USD')",
        },
      },
      required: ["query"],
    },
    execute: (args: Record<string, unknown>, _ctx: ToolContext) =>
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
          return safeJsonStringify(results);
        }),
      ),
    summarizeResult: (rawJson: string) => {
      const data = JSON.parse(rawJson);
      const count = Array.isArray(data) ? data.length : 0;
      return `Found ${count} ${count === 1 ? "product" : "products"}`;
    },
  },
  {
    name: "get_product_details",
    description:
      "Get complete product specifications, description, brand, and active pricing for a specific product ID.",
    parameters: {
      type: "object",
      properties: {
        productId: {
          type: "string",
          description: "The product identifier, e.g. 'prod-1'",
        },
        currency: {
          type: "string",
          description: "Optional currency code (e.g. 'USD')",
        },
      },
      required: ["productId"],
    },
    execute: (args: Record<string, unknown>, _ctx: ToolContext) =>
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
            return safeJsonStringify({ error: `Product with ID ${productId} not found.` });
          }
          yield* Effect.logInfo(`[get_product_details] found product: "${results[0]?.name}"`);
          return safeJsonStringify(results[0]);
        }),
      ),
    summarizeResult: (rawJson: string) => {
      const data = JSON.parse(rawJson);
      const name = String(data.productName ?? data.name ?? "Product");
      const price = data.price ? ` ($${data.price})` : "";
      return `${name}${price}`;
    },
  },
  {
    name: "get_cart",
    description:
      "Inspect the user's current shopping cart, including items, quantities, pricing, totals, and addresses.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: (_args: Record<string, unknown>, { userId }: ToolContext) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.logInfo(`[get_cart] fetching cart for userId="${userId}"`);
          const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
          const cart = yield* client.get({}).pipe(Effect.orDie);
          yield* Effect.logInfo(
            `[get_cart] userId="${userId}" cart item count: ${cart?.items.length ?? 0}, total: ${cart?.total ?? 0}`,
          );
          return safeJsonStringify(
            cart ?? {
              userId,
              items: [],
              total: 0,
              message: "Cart is currently empty.",
            },
          );
        }),
      ),
    summarizeResult: (rawJson: string) => {
      const data = JSON.parse(rawJson);
      const items = Array.isArray(data.items) ? data.items : [];
      const count = items.length;
      const total =
        typeof data.total === "number" ? data.total.toFixed(2) : String(data.total ?? "0");
      const currency = String(data.currency ?? "USD");
      return `${count} ${count === 1 ? "item" : "items"} (${currency} ${total})`;
    },
  },
  {
    name: "add_to_cart",
    description: "Add a product with a specified quantity into the user's cart.",
    parameters: {
      type: "object",
      properties: {
        productId: {
          type: "string",
          description: "ID of the product to add",
        },
        quantity: {
          type: "integer",
          minimum: 1,
          description: "Quantity of the item to add",
        },
      },
      required: ["productId", "quantity"],
    },
    execute: (args: Record<string, unknown>, { userId }: ToolContext) =>
      Effect.scoped(
        Effect.gen(function* () {
          const productId = String(args["productId"] ?? "");
          const quantity = Number(args["quantity"] ?? 1);
          yield* Effect.logInfo(
            `[add_to_cart] adding productId="${productId}" qty=${quantity} for userId="${userId}"`,
          );
          const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
          const result = yield* client.addItem({ productId, quantity }).pipe(
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
          return safeJsonStringify(result);
        }),
      ),
    summarizeResult: (rawJson: string) => {
      const data = JSON.parse(rawJson);
      const items = Array.isArray(data.items) ? data.items : [];
      const count = items.length;
      return `Added to cart (${count} ${count === 1 ? "item" : "items"} total)`;
    },
  },
  {
    name: "update_cart_quantity",
    description: "Update the quantity of an existing item in the user's cart.",
    parameters: {
      type: "object",
      properties: {
        productId: {
          type: "string",
          description: "ID of the product in the cart",
        },
        quantity: {
          type: "integer",
          minimum: 1,
          description: "New quantity",
        },
      },
      required: ["productId", "quantity"],
    },
    execute: (args: Record<string, unknown>, { userId }: ToolContext) =>
      Effect.scoped(
        Effect.gen(function* () {
          const productId = String(args["productId"] ?? "");
          const quantity = Number(args["quantity"] ?? 1);
          yield* Effect.logInfo(
            `[update_cart_quantity] updating productId="${productId}" to qty=${quantity} for userId="${userId}"`,
          );
          const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
          const result = yield* client.updateItemQuantity({ productId, quantity }).pipe(
            Effect.tap(() =>
              Effect.logInfo(
                `[update_cart_quantity] successfully updated productId="${productId}"`,
              ),
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
          return safeJsonStringify(result);
        }),
      ),
    summarizeResult: () => "Cart quantity updated",
  },
  {
    name: "remove_from_cart",
    description: "Remove an item from the user's shopping cart.",
    parameters: {
      type: "object",
      properties: {
        productId: {
          type: "string",
          description: "ID of the product to remove",
        },
      },
      required: ["productId"],
    },
    execute: (args: Record<string, unknown>, { userId }: ToolContext) =>
      Effect.scoped(
        Effect.gen(function* () {
          const productId = String(args["productId"] ?? "");
          yield* Effect.logInfo(
            `[remove_from_cart] removing productId="${productId}" for userId="${userId}"`,
          );
          const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
          const result = yield* client.removeItem({ productId }).pipe(
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
          return safeJsonStringify(result);
        }),
      ),
    summarizeResult: () => "Item removed from cart",
  },
  {
    name: "clear_cart",
    description: "Remove all items from the user's current shopping cart.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: (_args: Record<string, unknown>, { userId }: ToolContext) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.logInfo(`[clear_cart] clearing cart for userId="${userId}"`);
          const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
          yield* client.clear({}).pipe(Effect.orDie);
          yield* Effect.logInfo(`[clear_cart] cart cleared for userId="${userId}"`);
          return safeJsonStringify({ success: true, message: "Cart cleared successfully." });
        }),
      ),
    summarizeResult: () => "Cart cleared",
  },
  {
    name: "get_saved_contact_info",
    description:
      "Inspect the user's previous order history to retrieve saved shipping address, billing address, and email for 1-click checkout.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: (_args: Record<string, unknown>, { userId }: ToolContext) =>
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
          return safeJsonStringify(
            info ?? {
              found: false,
              message: "No saved contact info found from prior orders.",
            },
          );
        }),
      ),
    summarizeResult: (rawJson: string) => {
      const data = JSON.parse(rawJson);
      return data.found
        ? `Found saved info (${String(data.email ?? "")})`
        : "No saved contact info found";
    },
  },
  {
    name: "apply_saved_contact_info",
    description:
      "Apply the customer's saved shipping address, billing address, and email from their last order onto their active cart in one step.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: (_args: Record<string, unknown>, { userId }: ToolContext) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.logInfo(
            `[apply_saved_contact_info] applying saved contact info for userId="${userId}"`,
          );
          const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
          const result = yield* client.applySavedContactInfo({}).pipe(
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
          return safeJsonStringify(result);
        }),
      ),
    summarizeResult: () => "Applied saved contact details",
  },
  {
    name: "set_shipping_address",
    description: "Set or update the shipping address on the user's cart.",
    parameters: {
      type: "object",
      properties: {
        street: { type: "string" },
        city: { type: "string" },
        stateOrRegion: { type: "string" },
        country: { type: "string" },
        postalCode: { type: "string" },
        name: { type: "string", description: "Recipient name" },
        phoneNumber: { type: "string", description: "Recipient phone number" },
        email: { type: "string", description: "Contact email" },
      },
      required: ["street", "city", "stateOrRegion", "country", "postalCode"],
    },
    execute: (args: Record<string, unknown>, { userId }: ToolContext) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.logInfo(
            `[set_shipping_address] updating shipping address for userId="${userId}"`,
          );
          const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
          const result = yield* client
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
          return safeJsonStringify(result);
        }),
      ),
    summarizeResult: (rawJson: string) => {
      const data = JSON.parse(rawJson);
      const city = String(data.city ?? "");
      const country = String(data.country ?? "");
      return city || country ? `Shipping set (${city}, ${country})` : "Shipping address set";
    },
  },
  {
    name: "set_billing_address",
    description: "Set or update the billing address on the user's cart.",
    parameters: {
      type: "object",
      properties: {
        street: { type: "string" },
        city: { type: "string" },
        stateOrRegion: { type: "string" },
        country: { type: "string" },
        postalCode: { type: "string" },
        name: { type: "string" },
        phoneNumber: { type: "string" },
        email: { type: "string" },
      },
      required: ["street", "city", "stateOrRegion", "country", "postalCode"],
    },
    execute: (args: Record<string, unknown>, { userId }: ToolContext) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.logInfo(
            `[set_billing_address] updating billing address for userId="${userId}"`,
          );
          const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
          const result = yield* client
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
          return safeJsonStringify(result);
        }),
      ),
    summarizeResult: () => "Billing address set",
  },
  {
    name: "set_email",
    description: "Set the contact email on the cart for order receipt and confirmation.",
    parameters: {
      type: "object",
      properties: {
        email: { type: "string", description: "Customer contact email" },
      },
      required: ["email"],
    },
    execute: (args: Record<string, unknown>, { userId }: ToolContext) =>
      Effect.scoped(
        Effect.gen(function* () {
          const email = String(args["email"] ?? "");
          yield* Effect.logInfo(`[set_email] updating email="${email}" for userId="${userId}"`);
          const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
          const result = yield* client.updateEmail({ email }).pipe(
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
          return safeJsonStringify(result);
        }),
      ),
    summarizeResult: (rawJson: string) => {
      const data = JSON.parse(rawJson);
      return `Email set to ${String(data.email ?? "")}`;
    },
  },
  {
    name: "checkout_cart",
    description:
      "Execute checkout on the active cart. Pre-condition: cart must have items, email, and addresses set.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: (_args: Record<string, unknown>, { userId }: ToolContext) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.logInfo(`[checkout_cart] initiating checkout for userId="${userId}"`);
          const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
          const result = yield* client.checkout({}).pipe(
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
          return safeJsonStringify(result);
        }),
      ),
    summarizeResult: (rawJson: string) => {
      const data = JSON.parse(rawJson);
      const orderId = String(data.orderId ?? "");
      return orderId ? `Order #${orderId.slice(0, 8)} placed` : "Checkout complete";
    },
  },
  {
    name: "get_order_history",
    description:
      "Get a list of the user's past orders (most recent first) with line items, total, and status.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          description: "Maximum number of recent orders to retrieve (default 10)",
        },
      },
    },
    execute: (args: Record<string, unknown>, { userId }: ToolContext) =>
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
          return safeJsonStringify(orders);
        }),
      ),
    summarizeResult: (rawJson: string) => {
      const data = JSON.parse(rawJson);
      const count = Array.isArray(data) ? data.length : 0;
      return `${count} past ${count === 1 ? "order" : "orders"}`;
    },
  },
  {
    name: "get_order_details",
    description: "Get full details of a specific order by its order ID.",
    parameters: {
      type: "object",
      properties: {
        orderId: {
          type: "string",
          description: "The order ID, e.g. 'order-123'",
        },
      },
      required: ["orderId"],
    },
    execute: (args: Record<string, unknown>, _ctx: ToolContext) =>
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
          return safeJsonStringify(order ?? { error: `Order with ID ${orderId} not found.` });
        }),
      ),
    summarizeResult: (rawJson: string) => {
      const data = JSON.parse(rawJson);
      const status = String(data.status ?? data.orderStatus ?? "retrieved");
      const id = String(data.orderId ?? "").slice(0, 8);
      return id ? `Order #${id} (${status})` : "Order details retrieved";
    },
  },
];

export const toolsMap = new Map<string, AssistantToolDefinition>(
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
