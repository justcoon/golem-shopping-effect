import { Context, Result, Schema } from "effect";
import { Tool } from "@golemcloud/effect-golem";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import {
  createPiAgentTools,
  createToolFromAgentMethod,
  formatUnknownError,
  golemToolToPiAgentTools,
} from "../../ai/index.js";
import { OrderAgent } from "../order/index.js";
import { catalogTools, inventoryTools, managerOrderTools } from "../../tools/index.js";

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

export const managerOrderSpecificTools = [
  addOrderItemTool,
  removeOrderItemTool,
  updateOrderItemQuantityTool,
  updateOrderShippingAddressTool,
  updateOrderBillingAddressTool,
  updateOrderEmailTool,
] as const;

export function getManagerPiTools(
  managerId: string,
  context?: Context.Context<never>,
): AgentTool<TSchema>[] {
  const golemTools = [
    ...golemToolToPiAgentTools(catalogTools, { managerId }, context, {
      client: Tool.client(catalogTools),
      loggerNamespace: "[ManagerAgent]",
    }),
    ...golemToolToPiAgentTools(inventoryTools, { managerId }, context, {
      client: Tool.client(inventoryTools),
      loggerNamespace: "[ManagerAgent]",
    }),
    ...golemToolToPiAgentTools(managerOrderTools, { managerId }, context, {
      client: Tool.client(managerOrderTools),
      loggerNamespace: "[ManagerAgent]",
    }),
  ];

  const specificTools = createPiAgentTools(
    managerOrderSpecificTools,
    { managerId },
    context,
    "[ManagerAgent]",
  );

  return [...golemTools, ...specificTools];
}
