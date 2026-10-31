import { Schema } from "effect";
import type {
  Cart,
  CartUpdated,
  OrderConfirmation,
  SavedContactInfo,
} from "../cart/cart-schema.js";
import type { Order } from "../order/order-schema.js";
import type { ProductWithPrice } from "../product-search/product-search-agent.js";

export type EmptyCartFallback = {
  readonly userId: string;
  readonly items: readonly [];
  readonly total: number;
  readonly message: string;
  readonly currency?: string;
};

export type ToolErrorFallback = {
  readonly error: string;
};

export type ToolSuccessResult = {
  readonly success: boolean;
  readonly error?: string;
};

// ============================================================================
// Tool Argument Schemas (Effect Schema with annotations)
// ============================================================================

export const EmptyArgs = Schema.Struct({});
export type EmptyArgs = typeof EmptyArgs.Type;

export const SearchProductsArgs = Schema.Struct({
  query: Schema.String.annotate({
    description: "Search query keyword, e.g. 'earbuds', 'brand:Apple', or 'tag:flagship'",
  }),
  currency: Schema.optional(Schema.String).annotate({
    description: "Optional currency code (e.g. 'USD')",
  }),
});
export type SearchProductsArgs = typeof SearchProductsArgs.Type;

export const GetProductDetailsArgs = Schema.Struct({
  productId: Schema.String.annotate({
    description: "Product ID, e.g. 'ap001'",
  }),
  currency: Schema.optional(Schema.String).annotate({
    description: "Optional currency code (e.g. 'USD')",
  }),
});
export type GetProductDetailsArgs = typeof GetProductDetailsArgs.Type;

export const AddToCartArgs = Schema.Struct({
  productId: Schema.String.annotate({
    description: "Product ID to add, e.g. 'ap001'",
  }),
  quantity: Schema.optional(Schema.Number).annotate({
    description: "Quantity to add (positive integer, defaults to 1)",
  }),
});
export type AddToCartArgs = typeof AddToCartArgs.Type;

export const UpdateCartQuantityArgs = Schema.Struct({
  productId: Schema.String.annotate({
    description: "Product ID to update",
  }),
  quantity: Schema.Number.annotate({
    description: "New quantity (positive integer)",
  }),
});
export type UpdateCartQuantityArgs = typeof UpdateCartQuantityArgs.Type;

export const RemoveFromCartArgs = Schema.Struct({
  productId: Schema.String.annotate({
    description: "Product ID to remove from cart",
  }),
});
export type RemoveFromCartArgs = typeof RemoveFromCartArgs.Type;

export const SetAddressArgs = Schema.Struct({
  street: Schema.String.annotate({ description: "Street address" }),
  city: Schema.String.annotate({ description: "City" }),
  state: Schema.optional(Schema.String).annotate({ description: "State or province" }),
  stateOrRegion: Schema.optional(Schema.String).annotate({ description: "State or region code" }),
  country: Schema.String.annotate({ description: "Country code or name" }),
  postalCode: Schema.String.annotate({ description: "Postal or ZIP code" }),
  fullName: Schema.optional(Schema.String).annotate({ description: "Recipient full name" }),
  name: Schema.optional(Schema.String).annotate({ description: "Contact name" }),
  phone: Schema.optional(Schema.String).annotate({ description: "Contact phone number" }),
  phoneNumber: Schema.optional(Schema.String).annotate({ description: "Phone number" }),
  email: Schema.optional(Schema.String).annotate({ description: "Contact email address" }),
});
export type SetAddressArgs = typeof SetAddressArgs.Type;

export const SetEmailArgs = Schema.Struct({
  email: Schema.String.annotate({
    description: "Customer email address for notifications",
  }),
});
export type SetEmailArgs = typeof SetEmailArgs.Type;

export const CheckoutCartArgs = Schema.Struct({
  paymentMethod: Schema.optional(Schema.String).annotate({
    description: "Payment method, e.g. 'credit_card', 'paypal', 'apple_pay'",
  }),
});
export type CheckoutCartArgs = typeof CheckoutCartArgs.Type;

export const GetOrderHistoryArgs = Schema.Struct({
  limit: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of recent orders to retrieve (default 10)",
  }),
});
export type GetOrderHistoryArgs = typeof GetOrderHistoryArgs.Type;

export const GetOrderDetailsArgs = Schema.Struct({
  orderId: Schema.String.annotate({
    description: "The order ID, e.g. 'order-123'",
  }),
});
export type GetOrderDetailsArgs = typeof GetOrderDetailsArgs.Type;

// ============================================================================
// Automatic JSON Schema Derivation from Effect Schema
// ============================================================================

/**
 * Derives an OpenAI-compatible JSON Schema parameter object directly from an
 * Effect Schema using Effect's built-in Standard Schema v1 JSON Schema generator.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function schemaToJsonSchema(schema: Schema.Schema<any>): Record<string, unknown> {
  const std = Schema.toStandardJSONSchemaV1(schema);
  const doc = std["~standard"].jsonSchema.input({ target: "draft-07" }) as Record<string, unknown>;
  if (doc && doc.type === "object") {
    return doc;
  }
  // For empty structs (Schema.Struct({})), Standard Schema emits `{ not: { type: 'null' } }`,
  // but OpenAI/Gemini tool calling APIs strictly require `{ type: 'object', properties: {} }`.
  return {
    type: "object",
    properties: {},
  };
}

// ============================================================================
// Assistant Tool Specification
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AssistantToolSpec<TResult = unknown, TArgs = any> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Schema.Schema<TArgs>;
  readonly summarize: (data: TResult) => string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineToolSpec<TResult, TArgs = any>(spec: {
  readonly name: string;
  readonly description: string;
  readonly parameters: Schema.Schema<TArgs>;
  readonly summarize?: (data: TResult) => string;
  readonly summarizeResult?: (data: TResult) => string;
}): AssistantToolSpec<TResult, TArgs> {
  const summarize =
    spec.summarize ??
    spec.summarizeResult ??
    ((data: TResult) => {
      if (
        data &&
        typeof data === "object" &&
        "error" in data &&
        Boolean((data as { error: unknown }).error)
      ) {
        return `Failed: ${String((data as { error: unknown }).error)}`;
      }
      return "Completed";
    });

  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    summarize,
  };
}

export const searchProductsSpec = defineToolSpec<readonly ProductWithPrice[], SearchProductsArgs>({
  name: "search_products",
  description:
    "Search catalog for products matching a query (by keyword, brand, or tag) and return products with live pricing.",
  parameters: SearchProductsArgs,
  summarize: (data) => {
    const count = data?.length ?? 0;
    return `Found ${count} ${count === 1 ? "product" : "products"}`;
  },
});

export const getProductDetailsSpec = defineToolSpec<
  ProductWithPrice | ToolErrorFallback,
  GetProductDetailsArgs
>({
  name: "get_product_details",
  description:
    "Get complete product specifications, description, brand, and active pricing for a specific product ID.",
  parameters: GetProductDetailsArgs,
  summarize: (data) => {
    if ("error" in data) return `Error: ${data.error}`;
    const priceStr = data.price ? ` ($${data.price.price.toFixed(2)})` : "";
    return `Details: ${data.name}${priceStr}`;
  },
});

export const getCartSpec = defineToolSpec<Cart | EmptyCartFallback, EmptyArgs>({
  name: "get_cart",
  description: "Get the current shopping cart contents, total, and shipping address.",
  parameters: EmptyArgs,
  summarize: (data) => {
    const items = data.items ?? [];
    const count = items.length;
    const total = typeof data.total === "number" ? data.total.toFixed(2) : "0";
    const currency = ("currency" in data && data.currency) || "USD";
    return `${count} ${count === 1 ? "item" : "items"} (${currency} ${total})`;
  },
});

export const addToCartSpec = defineToolSpec<
  (CartUpdated & ToolSuccessResult) | ToolErrorFallback,
  AddToCartArgs
>({
  name: "add_to_cart",
  description: "Add an item to the shopping cart with a specific quantity.",
  parameters: AddToCartArgs,
  summarize: (data) => ("error" in data ? `Failed: ${data.error}` : "Item added to cart"),
});

export const updateCartQuantitySpec = defineToolSpec<
  (CartUpdated & ToolSuccessResult) | ToolErrorFallback,
  UpdateCartQuantityArgs
>({
  name: "update_cart_quantity",
  description: "Update the quantity of an existing item in the shopping cart.",
  parameters: UpdateCartQuantityArgs,
  summarize: (data) => ("error" in data ? `Failed: ${data.error}` : "Cart quantity updated"),
});

export const removeFromCartSpec = defineToolSpec<
  (CartUpdated & ToolSuccessResult) | ToolErrorFallback,
  RemoveFromCartArgs
>({
  name: "remove_from_cart",
  description: "Remove an item completely from the shopping cart.",
  parameters: RemoveFromCartArgs,
  summarize: (data) => ("error" in data ? `Failed: ${data.error}` : "Item removed from cart"),
});

export const clearCartSpec = defineToolSpec<ToolSuccessResult, EmptyArgs>({
  name: "clear_cart",
  description: "Remove all items from the shopping cart, resetting it to empty.",
  parameters: EmptyArgs,
  summarize: () => "Cart cleared",
});

export const getSavedContactInfoSpec = defineToolSpec<
  SavedContactInfo | ToolErrorFallback,
  EmptyArgs
>({
  name: "get_saved_contact_info",
  description:
    "Check if user has saved contact details (shipping address, billing address, email) from prior orders for 1-click checkout.",
  parameters: EmptyArgs,
  summarize: (data) => {
    if ("error" in data) return `Error: ${data.error}`;
    return data.shippingAddress
      ? `Saved address found for ${data.shippingAddress.name ?? "user"}`
      : "No saved address on file";
  },
});

export const applySavedContactInfoSpec = defineToolSpec<
  (CartUpdated & ToolSuccessResult) | ToolErrorFallback,
  EmptyArgs
>({
  name: "apply_saved_contact_info",
  description:
    "Pre-fill the current cart's shipping address, billing address, and email from the user's previous orders for 1-click checkout.",
  parameters: EmptyArgs,
  summarize: (data) =>
    "error" in data ? `Failed: ${data.error}` : "Applied saved contact info to cart",
});

export const setShippingAddressSpec = defineToolSpec<
  (CartUpdated & ToolSuccessResult) | ToolErrorFallback,
  SetAddressArgs
>({
  name: "set_shipping_address",
  description: "Set or update the shipping address on the current shopping cart.",
  parameters: SetAddressArgs,
  summarize: (data) => ("error" in data ? `Failed: ${data.error}` : "Shipping address set"),
});

export const setBillingAddressSpec = defineToolSpec<
  (CartUpdated & ToolSuccessResult) | ToolErrorFallback,
  SetAddressArgs
>({
  name: "set_billing_address",
  description: "Set or update the billing address on the current shopping cart.",
  parameters: SetAddressArgs,
  summarize: (data) => ("error" in data ? `Failed: ${data.error}` : "Billing address set"),
});

export const setEmailSpec = defineToolSpec<
  (CartUpdated & ToolSuccessResult) | ToolErrorFallback,
  SetEmailArgs
>({
  name: "set_email",
  description:
    "Set the contact email address on the current shopping cart for order notifications.",
  parameters: SetEmailArgs,
  summarize: (data) => ("error" in data ? `Failed: ${data.error}` : "Email updated"),
});

export const checkoutCartSpec = defineToolSpec<
  (OrderConfirmation & ToolSuccessResult) | ToolErrorFallback,
  CheckoutCartArgs
>({
  name: "checkout_cart",
  description:
    "Place the order with all items currently in the cart. Requires shipping address and email to be set.",
  parameters: CheckoutCartArgs,
  summarize: (data) => {
    if ("error" in data) return `Checkout failed: ${data.error}`;
    const id = data.orderId ? data.orderId.slice(0, 8) : "";
    return `Order placed successfully (#${id})`;
  },
});

export const getOrderHistorySpec = defineToolSpec<readonly Order[], GetOrderHistoryArgs>({
  name: "get_order_history",
  description: "Retrieve past order history for the current user.",
  parameters: GetOrderHistoryArgs,
  summarize: (data) => {
    const count = data?.length ?? 0;
    return `${count} past ${count === 1 ? "order" : "orders"}`;
  },
});

export const getOrderDetailsSpec = defineToolSpec<Order | ToolErrorFallback, GetOrderDetailsArgs>({
  name: "get_order_details",
  description: "Get full details of a specific order by its order ID.",
  parameters: GetOrderDetailsArgs,
  summarize: (data) => {
    if ("error" in data) return `Error: ${data.error}`;
    const status = data.orderStatus ?? "retrieved";
    const id = (data.orderId ?? "").slice(0, 8);
    return id ? `Order #${id} (${status})` : "Order details retrieved";
  },
});

export const shoppingAssistantToolSpecs = [
  searchProductsSpec,
  getProductDetailsSpec,
  getCartSpec,
  addToCartSpec,
  updateCartQuantitySpec,
  removeFromCartSpec,
  clearCartSpec,
  getSavedContactInfoSpec,
  applySavedContactInfoSpec,
  setShippingAddressSpec,
  setBillingAddressSpec,
  setEmailSpec,
  checkoutCartSpec,
  getOrderHistorySpec,
  getOrderDetailsSpec,
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAssistantToolSpec = AssistantToolSpec<any, any>;
