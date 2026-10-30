import type { Cart, CartUpdated, OrderConfirmation, SavedContactInfo } from "../cart/cart-schema.js";
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

export interface AssistantToolSpec<T = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly summarizeResult?: (data: T) => string;
}

export function defineToolSpec<T>(spec: AssistantToolSpec<T>): AssistantToolSpec<T> {
  return spec;
}

export const shoppingAssistantToolSpecs = [
  defineToolSpec<readonly ProductWithPrice[]>({
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
    summarizeResult: (data) => {
      const count = data?.length ?? 0;
      return `Found ${count} ${count === 1 ? "product" : "products"}`;
    },
  }),
  defineToolSpec<ProductWithPrice | ToolErrorFallback>({
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
    summarizeResult: (data) => {
      if ("error" in data) return `Error: ${data.error}`;
      const price = data.price?.price ? ` ($${data.price.price})` : "";
      return `${data.name}${price}`;
    },
  }),
  defineToolSpec<Cart | EmptyCartFallback>({
    name: "get_cart",
    description:
      "Inspect the user's current shopping cart, including items, quantities, pricing, totals, and addresses.",
    parameters: {
      type: "object",
      properties: {},
    },
    summarizeResult: (data) => {
      const items = data.items ?? [];
      const count = items.length;
      const total = typeof data.total === "number" ? data.total.toFixed(2) : "0";
      const currency = ("currency" in data && data.currency) || "USD";
      return `${count} ${count === 1 ? "item" : "items"} (${currency} ${total})`;
    },
  }),
  defineToolSpec<(ToolSuccessResult & Partial<CartUpdated>) | ToolSuccessResult>({
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
    summarizeResult: (data) => {
      if (data.error) return `Failed: ${data.error}`;
      return "Added to cart";
    },
  }),
  defineToolSpec<ToolSuccessResult & Partial<CartUpdated>>({
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
    summarizeResult: (data) => (data.error ? `Failed: ${data.error}` : "Cart quantity updated"),
  }),
  defineToolSpec<ToolSuccessResult & Partial<CartUpdated>>({
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
    summarizeResult: (data) => (data.error ? `Failed: ${data.error}` : "Item removed from cart"),
  }),
  defineToolSpec<{ readonly success: boolean; readonly message: string }>({
    name: "clear_cart",
    description: "Remove all items from the user's current shopping cart.",
    parameters: {
      type: "object",
      properties: {},
    },
    summarizeResult: () => "Cart cleared",
  }),
  defineToolSpec<SavedContactInfo | { readonly found: false; readonly message: string }>({
    name: "get_saved_contact_info",
    description:
      "Inspect the user's previous order history to retrieve saved shipping address, billing address, and email for 1-click checkout.",
    parameters: {
      type: "object",
      properties: {},
    },
    summarizeResult: (data) => {
      const hasEmail = "email" in data && data.email;
      return hasEmail ? `Found saved info (${data.email})` : "No saved contact info found";
    },
  }),
  defineToolSpec<ToolSuccessResult & Partial<CartUpdated>>({
    name: "apply_saved_contact_info",
    description:
      "Apply the customer's saved shipping address, billing address, and email from their last order onto their active cart in one step.",
    parameters: {
      type: "object",
      properties: {},
    },
    summarizeResult: (data) =>
      data.error ? `Failed: ${data.error}` : "Applied saved contact details",
  }),
  defineToolSpec<ToolSuccessResult & Partial<CartUpdated>>({
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
    summarizeResult: (data) => (data.error ? `Failed: ${data.error}` : "Shipping address set"),
  }),
  defineToolSpec<ToolSuccessResult & Partial<CartUpdated>>({
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
    summarizeResult: (data) => (data.error ? `Failed: ${data.error}` : "Billing address set"),
  }),
  defineToolSpec<ToolSuccessResult & Partial<CartUpdated>>({
    name: "set_email",
    description: "Set the contact email on the cart for order receipt and confirmation.",
    parameters: {
      type: "object",
      properties: {
        email: { type: "string", description: "Customer contact email" },
      },
      required: ["email"],
    },
    summarizeResult: (data) => (data.error ? `Failed: ${data.error}` : "Email updated"),
  }),
  defineToolSpec<OrderConfirmation | (ToolSuccessResult & { readonly orderId?: string })>({
    name: "checkout_cart",
    description:
      "Execute checkout on the active cart. Pre-condition: cart must have items, email, and addresses set.",
    parameters: {
      type: "object",
      properties: {},
    },
    summarizeResult: (data) => {
      const orderId = "orderId" in data ? data.orderId : undefined;
      return orderId ? `Order #${orderId.slice(0, 8)} placed` : "Checkout complete";
    },
  }),
  defineToolSpec<readonly Order[]>({
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
    summarizeResult: (data) => {
      const count = data?.length ?? 0;
      return `${count} past ${count === 1 ? "order" : "orders"}`;
    },
  }),
  defineToolSpec<Order | ToolErrorFallback>({
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
    summarizeResult: (data) => {
      if ("error" in data) return `Error: ${data.error}`;
      const status = data.orderStatus ?? "retrieved";
      const id = (data.orderId ?? "").slice(0, 8);
      return id ? `Order #${id} (${status})` : "Order details retrieved";
    },
  }),
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAssistantToolSpec = AssistantToolSpec<any>;

export const toolSpecsMap = new Map<string, AnyAssistantToolSpec>(
  shoppingAssistantToolSpecs.map((t) => [t.name, t]),
);

/**
 * Produces a concise summary of a tool result for stream events and UI pills
 * by delegating directly to the tool definition's summarizeResult.
 * Accepts either the structured data object directly or a raw JSON string.
 */
export function summarizeToolResult(toolName: string, rawOrParsed: unknown): string {
  if (rawOrParsed === null || rawOrParsed === undefined) return "Done";

  let data = rawOrParsed;
  if (typeof rawOrParsed === "string") {
    try {
      data = JSON.parse(rawOrParsed);
    } catch {
      return rawOrParsed.length > 50 ? rawOrParsed.slice(0, 50) + "..." : rawOrParsed;
    }
  }

  if (data && typeof data === "object" && "error" in data && (data as { error: unknown }).error) {
    return `Failed: ${String((data as { error: unknown }).error)}`;
  }

  const spec = toolSpecsMap.get(toolName);
  if (spec?.summarizeResult) {
    try {
      return spec.summarizeResult(data);
    } catch {
      return "Completed";
    }
  }
  return "Completed";
}
