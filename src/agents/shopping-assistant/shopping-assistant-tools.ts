import { Context, Result } from "effect";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import { schemaToJsonSchema } from "../../common/index.js";
import { CartAgentDefinition } from "../cart/index.js";
import {
  createPiAgentTools,
  createToolFromAgentMethod,
  golemToolToPiAgentTools,
  ToolContext,
  type AssistantToolDefinition,
} from "../../ai/index.js";
import { cartTools, catalogTools, customerOrderTools, inventoryTools } from "../../tools/index.js";

export { schemaToJsonSchema };

const userCartId = (ctx: ToolContext) => ({ id: ctx.userId ?? "" });

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
      return `Failed to update shipping address: ${result.failure}`;
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
      return `Failed to update billing address: ${result.failure}`;
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
    return `Failed to update email: ${result.failure}`;
  },
});

export const prepareCheckoutTool = createToolFromAgentMethod(
  CartAgentDefinition,
  "prepareCheckout",
  {
    toolName: "prepare_checkout",
    resolveId: userCartId,
    formatSummary: (result) => {
      if (Result.isSuccess(result)) {
        const draft = result.success.draft;
        return draft
          ? `Prepared checkout draft for order #${draft.orderId}. Items reserved for 10 minutes.`
          : "Prepared checkout.";
      }
      return `Failed to prepare checkout: ${result.failure.message}`;
    },
  },
);

export const confirmCheckoutTool = createToolFromAgentMethod(
  CartAgentDefinition,
  "confirmCheckout",
  {
    toolName: "confirm_checkout",
    resolveId: userCartId,
    formatSummary: (result) => {
      if (Result.isSuccess(result)) {
        return `Order successfully confirmed! Order ID: ${result.success.orderId}`;
      }
      return `Failed to confirm checkout: ${result.failure.message}`;
    },
  },
);

export const cancelCheckoutTool = createToolFromAgentMethod(CartAgentDefinition, "cancelCheckout", {
  toolName: "cancel_checkout",
  resolveId: userCartId,
  formatSummary: (result, args) => {
    if (Result.isSuccess(result)) {
      return `Cancelled checkout reservation for order #${args.orderId}`;
    }
    return `Failed to cancel checkout: ${result.failure}`;
  },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAssistantToolDefinition = AssistantToolDefinition<any, any>;

export const checkoutDraftTools: readonly AnyAssistantToolDefinition[] = [
  getSavedContactInfoTool,
  applySavedContactInfoTool,
  setShippingAddressTool,
  setBillingAddressTool,
  setEmailTool,
  prepareCheckoutTool,
  confirmCheckoutTool,
  cancelCheckoutTool,
];

export function getShoppingAssistantPiTools(
  userId: string,
  context?: Context.Context<never>,
): AgentTool<TSchema>[] {
  const golemTools = [
    ...golemToolToPiAgentTools(catalogTools, { userId }, context, {
      loggerNamespace: "[ShoppingAssistant]",
    }),
    ...golemToolToPiAgentTools(inventoryTools, { userId }, context, {
      loggerNamespace: "[ShoppingAssistant]",
    }),
    ...golemToolToPiAgentTools(cartTools, { userId }, context, {
      bind: { "user-id": userId },
      loggerNamespace: "[ShoppingAssistant]",
    }),
    ...golemToolToPiAgentTools(customerOrderTools, { userId }, context, {
      bind: { "user-id": userId },
      loggerNamespace: "[ShoppingAssistant]",
    }),
  ];

  const checkoutTools = createPiAgentTools(
    checkoutDraftTools,
    { userId },
    context,
    "[ShoppingAssistant]",
  );

  return [...golemTools, ...checkoutTools];
}
