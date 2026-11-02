import { Context, Result, Schema } from "effect";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import { formatUnknownError } from "../../ai/index.js";
import { createPiAgentTools, createToolFromAgentMethod } from "../../ai/index.js";
import { InventoryAgent } from "../inventory/index.js";
import { OrderAgent } from "../order/index.js";
import { OrderSearchAgent } from "../order-search/index.js";
import { ProductAgent } from "../product/index.js";
import { ProductSearchAgent } from "../product-search/index.js";

export const searchOrdersTool = createToolFromAgentMethod(OrderSearchAgent, "searchOrders", {
  toolName: "search_orders",
  description:
    "Search orders across system by query text, status (new, shipped, cancelled), or customer userId",
  resolveId: () => ({}),
  formatSummary: (res) => {
    if (Result.isSuccess(res)) {
      const orders = res.success;
      return `Found ${orders.length} matching order(s)`;
    }
    return `Failed to search orders: ${formatUnknownError(res.failure)}`;
  },
});

export const listRecentOrdersTool = createToolFromAgentMethod(OrderSearchAgent, "getRecentOrders", {
  toolName: "list_recent_orders",
  description: "List the most recent orders across the store",
  resolveId: () => ({}),
  formatSummary: (res) => {
    if (Result.isSuccess(res)) {
      return `Retrieved ${res.success.length} recent order(s)`;
    }
    return `Failed to retrieve recent orders: ${formatUnknownError(res.failure)}`;
  },
});

export const getOrderDetailsTool = createToolFromAgentMethod(OrderAgent, "get", {
  toolName: "get_order_details",
  description:
    "Get full details of a specific order including items, total, status, and shipping address",
  extraParameters: { orderId: Schema.String },
  resolveId: (_ctx, args) => ({ id: args.orderId }),
  formatSummary: (res, args) => {
    if (Result.isSuccess(res)) {
      const order = res.success;
      return order
        ? `Retrieved order ${order.orderId} (Status: ${order.orderStatus}, Total: $${order.total.toFixed(2)}, Items: ${order.items.length})`
        : `Order ${args.orderId} not found`;
    }
    return `Failed to retrieve order ${args.orderId}`;
  },
});

export const shipOrderTool = createToolFromAgentMethod(OrderAgent, "shipOrder", {
  toolName: "ship_order",
  description:
    "Ship an existing new order. Fulfills inventory allocations and marks order status as 'shipped'.",
  extraParameters: { orderId: Schema.String },
  resolveId: (_ctx, args) => ({ id: args.orderId }),
  formatSummary: (res, args) => {
    if (Result.isSuccess(res)) {
      return `Order ${args.orderId} has been successfully shipped and inventory fulfilled`;
    }
    return `Failed to ship order ${args.orderId}: ${formatUnknownError(res.failure)}`;
  },
});

export const cancelOrderTool = createToolFromAgentMethod(OrderAgent, "cancelOrder", {
  toolName: "cancel_order",
  description:
    "Cancel an existing new order. Releases reserved inventory allocations and marks order status as 'cancelled'.",
  extraParameters: { orderId: Schema.String },
  resolveId: (_ctx, args) => ({ id: args.orderId }),
  formatSummary: (res, args) => {
    if (Result.isSuccess(res)) {
      return `Order ${args.orderId} has been successfully cancelled and inventory released`;
    }
    return `Failed to cancel order ${args.orderId}: ${formatUnknownError(res.failure)}`;
  },
});

export const addOrderItemTool = createToolFromAgentMethod(OrderAgent, "addItem", {
  toolName: "add_order_item",
  description: "Add a product item to an existing new order. Reserves required inventory.",
  extraParameters: { orderId: Schema.String },
  resolveId: (_ctx, args) => ({ id: args.orderId }),
  formatSummary: (res, args) => {
    if (Result.isSuccess(res)) {
      return `Added item ${args.productId} (qty: ${args.quantity}) to order ${args.orderId}`;
    }
    return `Failed to add item to order ${args.orderId}: ${formatUnknownError(res.failure)}`;
  },
});

export const removeOrderItemTool = createToolFromAgentMethod(OrderAgent, "removeItem", {
  toolName: "remove_order_item",
  description: "Remove an item from an existing new order. Releases reserved inventory.",
  extraParameters: { orderId: Schema.String },
  resolveId: (_ctx, args) => ({ id: args.orderId }),
  formatSummary: (res, args) => {
    if (Result.isSuccess(res)) {
      return `Removed item ${args.productId} from order ${args.orderId}`;
    }
    return `Failed to remove item from order ${args.orderId}: ${formatUnknownError(res.failure)}`;
  },
});

export const updateOrderItemQuantityTool = createToolFromAgentMethod(
  OrderAgent,
  "updateItemQuantity",
  {
    toolName: "update_order_item_quantity",
    description:
      "Update the quantity of an item in an existing new order. Adjusts inventory reservations.",
    extraParameters: { orderId: Schema.String },
    resolveId: (_ctx, args) => ({ id: args.orderId }),
    formatSummary: (res, args) => {
      if (Result.isSuccess(res)) {
        return `Updated quantity for item ${args.productId} in order ${args.orderId} to ${args.quantity}`;
      }
      return `Failed to update quantity in order ${args.orderId}: ${formatUnknownError(res.failure)}`;
    },
  },
);

export const updateOrderShippingAddressTool = createToolFromAgentMethod(
  OrderAgent,
  "updateShippingAddress",
  {
    toolName: "update_order_shipping_address",
    description: "Update recipient shipping address on an existing new order",
    extraParameters: { orderId: Schema.String },
    resolveId: (_ctx, args) => ({ id: args.orderId }),
    formatSummary: (res, args) => {
      if (Result.isSuccess(res)) {
        return `Updated shipping address on order ${args.orderId}`;
      }
      return `Failed to update shipping address on order ${args.orderId}: ${formatUnknownError(res.failure)}`;
    },
  },
);

export const updateOrderBillingAddressTool = createToolFromAgentMethod(
  OrderAgent,
  "updateBillingAddress",
  {
    toolName: "update_order_billing_address",
    description: "Update billing address on an existing new order",
    extraParameters: { orderId: Schema.String },
    resolveId: (_ctx, args) => ({ id: args.orderId }),
    formatSummary: (res, args) => {
      if (Result.isSuccess(res)) {
        return `Updated billing address on order ${args.orderId}`;
      }
      return `Failed to update billing address on order ${args.orderId}: ${formatUnknownError(res.failure)}`;
    },
  },
);

export const updateOrderEmailTool = createToolFromAgentMethod(OrderAgent, "updateEmail", {
  toolName: "update_order_email",
  description: "Update customer contact email on an existing new order",
  extraParameters: { orderId: Schema.String },
  resolveId: (_ctx, args) => ({ id: args.orderId }),
  formatSummary: (res, args) => {
    if (Result.isSuccess(res)) {
      return `Updated customer email on order ${args.orderId}`;
    }
    return `Failed to update email on order ${args.orderId}: ${formatUnknownError(res.failure)}`;
  },
});

export const checkProductDetailsTool = createToolFromAgentMethod(ProductAgent, "get", {
  toolName: "check_product_details",
  description: "Get product details by productId (name, brand, description, tags)",
  extraParameters: { productId: Schema.String },
  resolveId: (_ctx, args) => ({ id: args.productId }),
  formatSummary: (res, args) => {
    if (Result.isSuccess(res)) {
      const p = res.success;
      return p
        ? `Product ${p.productId}: ${p.name} (${p.brand})`
        : `Product ${args.productId} not found`;
    }
    return `Failed to get product ${args.productId}`;
  },
});

export const checkInventoryTool = createToolFromAgentMethod(
  InventoryAgent,
  "getAvailableQuantity",
  {
    toolName: "check_inventory",
    description: "Check available and total stock quantity for a product in a region",
    extraParameters: { productId: Schema.String },
    resolveId: (_ctx, args) => ({ id: args.productId }),
    mapInput: (args) => ({ region: args.region || "global" }),
    formatSummary: (res, args) => {
      if (Result.isSuccess(res)) {
        const inv = res.success;
        return `Product ${args.productId} has ${inv.availableQuantity} available in region ${inv.region} (total: ${inv.totalQuantity}, allocated: ${inv.allocatedQuantity})`;
      }
      return `Failed to check inventory for ${args.productId}`;
    },
  },
);

export const searchProductsTool = createToolFromAgentMethod(
  ProductSearchAgent,
  "searchWithPrices",
  {
    toolName: "search_products",
    description: "Search product catalog for items by name, brand, or query keywords",
    formatSummary: (res) => {
      if (Result.isSuccess(res)) {
        return `Found ${res.success.length} matching product(s)`;
      }
      return `Failed to search products: ${formatUnknownError(res.failure)}`;
    },
  },
);

export const managerTools = [
  searchOrdersTool,
  getOrderDetailsTool,
  listRecentOrdersTool,
  shipOrderTool,
  cancelOrderTool,
  addOrderItemTool,
  removeOrderItemTool,
  updateOrderItemQuantityTool,
  updateOrderShippingAddressTool,
  updateOrderBillingAddressTool,
  updateOrderEmailTool,
  checkProductDetailsTool,
  checkInventoryTool,
  searchProductsTool,
] as const;

export function getManagerPiTools(
  managerId: string,
  context?: Context.Context<never>,
): AgentTool<TSchema>[] {
  return createPiAgentTools(managerTools, { managerId }, context, "[ManagerAgent]");
}
