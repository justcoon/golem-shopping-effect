import { Context } from "effect";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import { schemaToJsonSchema } from "../../common/index.js";
import { golemToolToPiAgentTools } from "../../ai/index.js";
import { cartTools, catalogTools, customerOrderTools, inventoryTools } from "../../tools/index.js";

export { schemaToJsonSchema };

const cartFormatSummary: Record<
  string,
  (result: unknown, args: Record<string, unknown>) => string
> = {
  getCart: (res) => {
    const cart = res as { items?: unknown[]; total?: number } | null;
    return cart && cart.items && cart.items.length > 0
      ? `Cart has ${cart.items.length} items (total: $${cart.total})`
      : "Cart is currently empty.";
  },
  addToCart: (_res, args) =>
    `Added item ${args["product-id"] ?? args.productId} (qty: ${args.quantity ?? 1}) to cart`,
  updateCartQuantity: (_res, args) =>
    `Updated quantity of ${args["product-id"] ?? args.productId} to ${args.quantity}`,
  removeFromCart: (_res, args) => `Removed item ${args["product-id"] ?? args.productId} from cart`,
  clearCart: () => "Cleared all items from cart",
  getSavedContactInfo: (res) =>
    res ? "Retrieved saved contact info" : "No saved contact info found",
  applySavedContactInfo: () => "Applied saved contact info to cart",
  setShippingAddress: () => "Updated shipping address",
  setBillingAddress: () => "Updated billing address",
  setEmail: (_res, args) => `Updated email to ${args.email}`,
  prepareCheckout: (res) => {
    const cart = res as { draft?: { orderId?: string }; total?: number; currency?: string } | null;
    const draft = cart?.draft;
    return draft?.orderId
      ? `Prepared checkout draft for order #${draft.orderId}. Items reserved for 10 minutes.`
      : "Prepared checkout.";
  },
  confirmCheckout: (res) => {
    const conf = res as { orderId?: string } | null;
    return conf?.orderId
      ? `Order successfully confirmed! Order ID: ${conf.orderId}`
      : "Order successfully confirmed!";
  },
  cancelCheckout: (_res, args) =>
    `Cancelled checkout reservation for order #${args["order-id"] ?? args.orderId ?? ""}`,
};

const catalogFormatSummary: Record<
  string,
  (result: unknown, args: Record<string, unknown>) => string
> = {
  searchProducts: (res, args) => {
    const list = Array.isArray(res) ? res : [];
    return `Found ${list.length} products for '${args.query}'`;
  },
  getProductDetails: (res, args) => {
    const list = Array.isArray(res) ? res : [];
    const prod = list[0] as { name?: string; productId?: string } | undefined;
    return prod
      ? `Details for ${prod.name} (${prod.productId})`
      : `Product with ID ${args["product-id"] ?? args.productId} not found.`;
  },
};

const customerOrderFormatSummary: Record<
  string,
  (result: unknown, args: Record<string, unknown>) => string
> = {
  getOrderHistory: (res) => {
    const list = Array.isArray(res) ? res : [];
    return `Retrieved ${list.length} past orders`;
  },
  getOrderDetails: (res, args) => {
    const order = res as { orderId?: string; orderStatus?: string; total?: number } | null;
    return order
      ? `Order ${order.orderId} status: ${order.orderStatus} (total: $${order.total})`
      : `Order with ID ${args["order-id"] ?? args.orderId} not found.`;
  },
};

const inventoryFormatSummary: Record<
  string,
  (result: unknown, args: Record<string, unknown>) => string
> = {
  checkInventory: (res, args) => {
    const inv = res as { inStock?: boolean; availableQuantity?: number } | null;
    const id = args["product-id"] ?? args.productId;
    return inv
      ? `Product ${id} inventory: ${inv.inStock ? `${inv.availableQuantity} available` : "Out of stock"}`
      : `Inventory check for ${id} completed.`;
  },
};

export function getShoppingAssistantPiTools(
  userId: string,
  context?: Context.Context<never>,
): AgentTool<TSchema>[] {
  return [
    ...golemToolToPiAgentTools(catalogTools, { userId }, context, {
      useImpl: true,
      loggerNamespace: "[ShoppingAssistant]",
      formatSummary: catalogFormatSummary,
    }),
    ...golemToolToPiAgentTools(inventoryTools, { userId }, context, {
      useImpl: true,
      loggerNamespace: "[ShoppingAssistant]",
      formatSummary: inventoryFormatSummary,
    }),
    ...golemToolToPiAgentTools(cartTools, { userId }, context, {
      useImpl: true,
      bind: { "user-id": userId },
      loggerNamespace: "[ShoppingAssistant]",
      formatSummary: cartFormatSummary,
    }),
    ...golemToolToPiAgentTools(customerOrderTools, { userId }, context, {
      useImpl: true,
      bind: { "user-id": userId },
      loggerNamespace: "[ShoppingAssistant]",
      formatSummary: customerOrderFormatSummary,
    }),
  ];
}
