import { Context, Result, Schema } from "effect";
import { schemaToJsonSchema } from "../../common/index.js";
import { CartAgentDefinition } from "../cart/index.js";
import { InventoryAgent } from "../inventory/index.js";
import { OrderAgent } from "../order/index.js";
import { ProductSearchAgent } from "../product-search/index.js";
import { createPiAgentTools } from "./shopping-assistant-pi-tools.js";
import {
  createToolFromAgentMethod,
  ToolContext,
  type AssistantToolDefinition,
} from "./shopping-assistant-tool-generator.js";

export { schemaToJsonSchema };

const userCartId = (ctx: ToolContext) => ({ id: ctx.userId ?? "" });

export const searchProductsTool = createToolFromAgentMethod(
  ProductSearchAgent,
  "searchWithPrices",
  {
    toolName: "search_products",
    formatSummary: (result, args) => {
      if (Result.isSuccess(result)) {
        return `Found ${result.success.length} products for '${args.query}'`;
      }
      return `Failed to search products: ${result.failure}`;
    },
  },
);

export const getProductDetailsTool = createToolFromAgentMethod(
  ProductSearchAgent,
  "getByIdsWithPrices",
  {
    toolName: "get_product_details",
    extraParameters: {
      productId: Schema.String.annotate({ description: "Product ID, e.g. 'ap001'" }),
    },
    mapInput: (args) => ({ ids: args.productId, currency: args.currency }),
    formatSummary: (result, args) => {
      if (Result.isSuccess(result)) {
        const prod = result.success[0];
        return prod
          ? `Details for ${prod.name} (${prod.productId})`
          : `Product with ID ${args.productId} not found.`;
      }
      return `Failed to get product details: ${result.failure}`;
    },
  },
);

export const getCartTool = createToolFromAgentMethod(CartAgentDefinition, "get", {
  toolName: "get_cart",
  resolveId: userCartId,
  formatSummary: (result) => {
    if (Result.isSuccess(result)) {
      const cart = result.success;
      return cart && cart.items.length > 0
        ? `Cart has ${cart.items.length} items (total: $${cart.total})`
        : "Cart is currently empty.";
    }
    return `Failed to retrieve cart: ${result.failure}`;
  },
});

export const addToCartTool = createToolFromAgentMethod(CartAgentDefinition, "addItem", {
  toolName: "add_to_cart",
  resolveId: userCartId,
  formatSummary: (result, args) => {
    if (Result.isSuccess(result)) {
      return `Added item ${args.productId} (qty: ${args.quantity ?? 1}) to cart`;
    }
    return `Failed to add item to cart: ${result.failure.message}`;
  },
});

export const updateCartQuantityTool = createToolFromAgentMethod(
  CartAgentDefinition,
  "updateItemQuantity",
  {
    toolName: "update_cart_quantity",
    resolveId: userCartId,
    formatSummary: (result, args) => {
      if (Result.isSuccess(result)) {
        return `Updated quantity of ${args.productId} to ${args.quantity}`;
      }
      return `Failed to update quantity: ${result.failure.message}`;
    },
  },
);

export const removeFromCartTool = createToolFromAgentMethod(CartAgentDefinition, "removeItem", {
  toolName: "remove_from_cart",
  resolveId: userCartId,
  formatSummary: (result, args) => {
    if (Result.isSuccess(result)) {
      return `Removed item ${args.productId} from cart`;
    }
    return `Failed to remove item: ${result.failure.message}`;
  },
});

export const clearCartTool = createToolFromAgentMethod(CartAgentDefinition, "clear", {
  toolName: "clear_cart",
  resolveId: userCartId,
  formatSummary: (result) => {
    if (Result.isSuccess(result)) {
      return "Cleared all items from cart";
    }
    return `Failed to clear cart: ${result.failure}`;
  },
});

export const getSavedContactInfoTool = createToolFromAgentMethod(
  CartAgentDefinition,
  "getSavedContactInfo",
  {
    toolName: "get_saved_contact_info",
    resolveId: userCartId,
    formatSummary: (result) => {
      if (Result.isSuccess(result)) {
        return result.success ? "Retrieved saved contact info" : "No saved contact info found";
      }
      return `Failed to retrieve saved contact info: ${result.failure}`;
    },
  },
);

export const applySavedContactInfoTool = createToolFromAgentMethod(
  CartAgentDefinition,
  "applySavedContactInfo",
  {
    toolName: "apply_saved_contact_info",
    resolveId: userCartId,
    formatSummary: (result) => {
      if (Result.isSuccess(result)) {
        return "Applied saved contact info to cart";
      }
      return `Failed to apply saved contact info: ${result.failure.message}`;
    },
  },
);

export const setShippingAddressTool = createToolFromAgentMethod(
  CartAgentDefinition,
  "updateShippingAddress",
  {
    toolName: "set_shipping_address",
    resolveId: userCartId,
    formatSummary: (result) => {
      if (Result.isSuccess(result)) {
        return "Updated shipping address";
      }
      return `Failed to update shipping address: ${result.failure.message}`;
    },
  },
);

export const setBillingAddressTool = createToolFromAgentMethod(
  CartAgentDefinition,
  "updateBillingAddress",
  {
    toolName: "set_billing_address",
    resolveId: userCartId,
    formatSummary: (result) => {
      if (Result.isSuccess(result)) {
        return "Updated billing address";
      }
      return `Failed to update billing address: ${result.failure.message}`;
    },
  },
);

export const setEmailTool = createToolFromAgentMethod(CartAgentDefinition, "updateEmail", {
  toolName: "set_email",
  resolveId: userCartId,
  formatSummary: (result, args) => {
    if (Result.isSuccess(result)) {
      return `Updated email to ${args.email}`;
    }
    return `Failed to update email: ${result.failure.message}`;
  },
});

export const checkoutCartTool = createToolFromAgentMethod(CartAgentDefinition, "checkout", {
  toolName: "checkout_cart",
  resolveId: userCartId,
  formatSummary: (result) => {
    if (Result.isSuccess(result)) {
      return `Checkout complete! Order ID: ${result.success.orderId}`;
    }
    return `Checkout failed: ${result.failure.message}`;
  },
});

export const getOrderHistoryTool = createToolFromAgentMethod(
  CartAgentDefinition,
  "getOrderHistory",
  {
    toolName: "get_order_history",
    resolveId: userCartId,
    formatSummary: (result) => {
      if (Result.isSuccess(result)) {
        return `Retrieved ${result.success.length} past orders`;
      }
      return `Failed to get order history: ${result.failure}`;
    },
  },
);

export const getOrderDetailsTool = createToolFromAgentMethod(OrderAgent, "get", {
  toolName: "get_order_details",
  extraParameters: {
    orderId: Schema.String.annotate({ description: "Order ID to look up, e.g. 'ord-123'" }),
  },
  resolveId: (_ctx, args) => ({ id: args.orderId }),
  formatSummary: (result, args) => {
    if (Result.isSuccess(result)) {
      const order = result.success;
      return order
        ? `Order ${order.orderId} status: ${order.orderStatus} (total: $${order.total})`
        : `Order with ID ${args.orderId} not found.`;
    }
    return `Failed to get order details: ${result.failure}`;
  },
});

export const checkInventoryTool = createToolFromAgentMethod(
  InventoryAgent,
  "getAvailableQuantity",
  {
    toolName: "check_inventory",
    extraParameters: {
      productId: Schema.String.annotate({
        description: "Product ID to check inventory for, e.g. 'ap001'",
      }),
    },
    resolveId: (_ctx, args) => ({ id: args.productId }),
    formatSummary: (result, args) => {
      if (Result.isSuccess(result)) {
        return `Product ${args.productId} has ${result.success.availableQuantity} units available in region ${args.region}`;
      }
      return `Failed to check inventory: ${result.failure}`;
    },
  },
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAssistantToolDefinition = AssistantToolDefinition<any, any>;

export const shoppingAssistantTools: readonly AnyAssistantToolDefinition[] = [
  searchProductsTool,
  getProductDetailsTool,
  checkInventoryTool,
  getCartTool,
  addToCartTool,
  updateCartQuantityTool,
  removeFromCartTool,
  clearCartTool,
  getSavedContactInfoTool,
  applySavedContactInfoTool,
  setShippingAddressTool,
  setBillingAddressTool,
  setEmailTool,
  checkoutCartTool,
  getOrderHistoryTool,
  getOrderDetailsTool,
];

export const toolsMap = new Map<string, AnyAssistantToolDefinition>(
  shoppingAssistantTools.map((t) => [t.name, t]),
);

export const toolsOpenAiFormat = shoppingAssistantTools.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: schemaToJsonSchema(t.parameters),
  },
}));

export function getShoppingAssistantPiTools(userId: string, context?: Context.Context<never>) {
  return createPiAgentTools(shoppingAssistantTools, userId, context);
}
