import { Context, Effect, Result, Schema } from "effect";
import { safeJsonStringify, schemaToJsonSchema } from "../../common/index.js";
import { CartAgentDefinition } from "../cart/index.js";
import { OrderAgent } from "../order/index.js";
import { ProductSearchAgent } from "../product-search/index.js";
import { createPiAgentTools } from "./shopping-assistant-pi-tools.js";
import { createToolFromAgentMethod } from "./shopping-assistant-tool-generator.js";

export { schemaToJsonSchema };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AssistantToolSpec<TResult = unknown, TArgs = any> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Schema.Schema<TArgs>;
  readonly summarize: (data: TResult) => string;
}

export interface ToolContext {
  readonly userId: string;
}

export interface ToolExecutionOutput {
  readonly summary: string;
  readonly resultString: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AssistantToolDefinition<TResult = unknown, TArgs = any> extends AssistantToolSpec<
  TResult,
  TArgs
> {
  readonly execute: (
    args: TArgs,
    ctx: ToolContext,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Effect.Effect<TResult, never, any>;
  readonly run: (
    rawArgs: unknown,
    ctx: ToolContext,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Effect.Effect<ToolExecutionOutput, never, any>;
}

export function createAssistantTool<TResult, TArgs>(
  spec: AssistantToolSpec<TResult, TArgs>,
  execute: (
    args: TArgs,
    ctx: ToolContext,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => Effect.Effect<TResult, never, any>,
): AssistantToolDefinition<TResult, TArgs> {
  return {
    ...spec,
    execute,
    run: (rawArgs: unknown, ctx: ToolContext) =>
      Effect.gen(function* () {
        // Decode and validate using the Effect Schema!
        const decoded = yield* Schema.decodeUnknownEffect(spec.parameters)(rawArgs ?? {}).pipe(
          Effect.catch((err: unknown) => {
            const msg = `Invalid arguments for tool '${spec.name}': ${err instanceof Error ? err.message : String(err)}`;
            return Effect.logWarning(`[ShoppingAssistant] ${msg}`).pipe(Effect.as(new Error(msg)));
          }),
        );

        if (decoded instanceof Error) {
          return {
            summary: `Failed: ${decoded.message}`,
            resultString: safeJsonStringify({ error: decoded.message }),
          };
        }

        const result: TResult = yield* execute(decoded, ctx).pipe(
          Effect.catch((err: unknown) =>
            Effect.logError(
              `[ShoppingAssistant] Tool '${spec.name}' failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
            ).pipe(
              Effect.as({
                error: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
              } as TResult),
            ),
          ),
        );

        const summary =
          result &&
          typeof result === "object" &&
          "error" in result &&
          Boolean((result as { error: unknown }).error)
            ? `Failed: ${String((result as { error: unknown }).error)}`
            : spec.summarize(result);

        const resultString = typeof result === "string" ? result : safeJsonStringify(result);

        return { summary, resultString };
      }),
  };
}

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
  resolveId: ({ userId }: ToolContext) => ({ id: userId }),
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
  resolveId: ({ userId }: ToolContext) => ({ id: userId }),
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
    resolveId: ({ userId }: ToolContext) => ({ id: userId }),
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
  resolveId: ({ userId }: ToolContext) => ({ id: userId }),
  formatSummary: (result, args) => {
    if (Result.isSuccess(result)) {
      return `Removed item ${args.productId} from cart`;
    }
    return `Failed to remove item: ${result.failure.message}`;
  },
});

export const clearCartTool = createToolFromAgentMethod(CartAgentDefinition, "clear", {
  toolName: "clear_cart",
  resolveId: ({ userId }: ToolContext) => ({ id: userId }),
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
    resolveId: ({ userId }: ToolContext) => ({ id: userId }),
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
    resolveId: ({ userId }: ToolContext) => ({ id: userId }),
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
    resolveId: ({ userId }: ToolContext) => ({ id: userId }),
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
    resolveId: ({ userId }: ToolContext) => ({ id: userId }),
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
  resolveId: ({ userId }: ToolContext) => ({ id: userId }),
  formatSummary: (result, args) => {
    if (Result.isSuccess(result)) {
      return `Updated email to ${args.email}`;
    }
    return `Failed to update email: ${result.failure.message}`;
  },
});

export const checkoutCartTool = createToolFromAgentMethod(CartAgentDefinition, "checkout", {
  toolName: "checkout_cart",
  resolveId: ({ userId }: ToolContext) => ({ id: userId }),
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
    resolveId: ({ userId }: ToolContext) => ({ id: userId }),
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAssistantToolDefinition = AssistantToolDefinition<any, any>;

export const shoppingAssistantTools: readonly AnyAssistantToolDefinition[] = [
  searchProductsTool,
  getProductDetailsTool,
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
