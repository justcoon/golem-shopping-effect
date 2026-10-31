import { Context, Effect, Schema } from "effect";
import { safeJsonStringify } from "../../common/index.js";
import { CartAgentDefinition } from "../cart/index.js";
import { OrderAgent } from "../order/index.js";
import { ProductSearchAgent } from "../product-search/index.js";
import { createPiAgentTools } from "./shopping-assistant-pi-tools.js";
import {
  AddToCartArgs,
  addToCartSpec,
  applySavedContactInfoSpec,
  AssistantToolSpec,
  CheckoutCartArgs,
  checkoutCartSpec,
  clearCartSpec,
  EmptyArgs,
  getCartSpec,
  GetOrderDetailsArgs,
  getOrderDetailsSpec,
  GetOrderHistoryArgs,
  getOrderHistorySpec,
  GetProductDetailsArgs,
  getProductDetailsSpec,
  getSavedContactInfoSpec,
  RemoveFromCartArgs,
  removeFromCartSpec,
  schemaToJsonSchema,
  SearchProductsArgs,
  searchProductsSpec,
  SetAddressArgs,
  setBillingAddressSpec,
  SetEmailArgs,
  setEmailSpec,
  setShippingAddressSpec,
  shoppingAssistantToolSpecs,
  UpdateCartQuantityArgs,
  updateCartQuantitySpec,
} from "./shopping-assistant-tool-specs.js";

export { shoppingAssistantToolSpecs };

export interface ToolContext {
  readonly userId: string;
}

export interface ToolExecutionOutput {
  readonly summary: string;
  readonly resultString: string;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return fallback;
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

export const searchProductsTool = createAssistantTool(
  searchProductsSpec,
  ({ query, currency }: SearchProductsArgs, _ctx: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* ProductSearchAgent.client.newPhantom({}).pipe(Effect.orDie);
        const { value: results } = yield* client
          .searchWithPrices({ query, currency })
          .pipe(Effect.orDie);
        return results;
      }),
    ),
);

export const getProductDetailsTool = createAssistantTool(
  getProductDetailsSpec,
  ({ productId, currency }: GetProductDetailsArgs, _ctx: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* ProductSearchAgent.client.newPhantom({}).pipe(Effect.orDie);
        const { value: results } = yield* client
          .getByIdsWithPrices({ ids: productId, currency })
          .pipe(Effect.orDie);
        if (results.length === 0) {
          return { error: `Product with ID ${productId} not found.` };
        }
        return results[0]!;
      }),
    ),
);

export const getCartTool = createAssistantTool(
  getCartSpec,
  (_args: EmptyArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        const cart = yield* client.get({}).pipe(Effect.orDie);
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
);

export const addToCartTool = createAssistantTool(
  addToCartSpec,
  ({ productId, quantity = 1 }: AddToCartArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const qty = Math.max(1, Math.floor(quantity));
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.addItem({ productId, quantity: qty }).pipe(
          Effect.map((res) => ({ success: true, ...res })),
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Failed to add item to cart.");
            return Effect.succeed({
              success: false,
              error: msg,
            });
          }),
        );
      }),
    ),
);

export const updateCartQuantityTool = createAssistantTool(
  updateCartQuantitySpec,
  ({ productId, quantity }: UpdateCartQuantityArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const qty = Math.max(0, Math.floor(quantity));
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.updateItemQuantity({ productId, quantity: qty }).pipe(
          Effect.map((res) => ({ success: true, ...res })),
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Failed to update item quantity.");
            return Effect.succeed({
              success: false,
              error: msg,
            });
          }),
        );
      }),
    ),
);

export const removeFromCartTool = createAssistantTool(
  removeFromCartSpec,
  ({ productId }: RemoveFromCartArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.removeItem({ productId }).pipe(
          Effect.map((res) => ({ success: true, ...res })),
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Failed to remove item from cart.");
            return Effect.succeed({
              success: false,
              error: msg,
            });
          }),
        );
      }),
    ),
);

export const clearCartTool = createAssistantTool(
  clearCartSpec,
  (_args: EmptyArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        yield* client.clear({}).pipe(Effect.orDie);
        return { success: true };
      }),
    ),
);

export const getSavedContactInfoTool = createAssistantTool(
  getSavedContactInfoSpec,
  (_args: EmptyArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        const info = yield* client.getSavedContactInfo({}).pipe(
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Failed to retrieve saved contact info.");
            return Effect.succeed({ error: msg });
          }),
        );
        if (info && "error" in info) {
          return info;
        }
        return (
          info ?? {
            shippingAddress: null,
            billingAddress: null,
            email: null,
            sourceOrderId: null,
          }
        );
      }),
    ),
);

export const applySavedContactInfoTool = createAssistantTool(
  applySavedContactInfoSpec,
  (_args: EmptyArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.applySavedContactInfo({}).pipe(
          Effect.map((res) => ({ success: true, ...res })),
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Failed to apply saved contact info.");
            return Effect.succeed({
              success: false,
              error: msg,
            });
          }),
        );
      }),
    ),
);

export const setShippingAddressTool = createAssistantTool(
  setShippingAddressSpec,
  (args: SetAddressArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client
          .updateShippingAddress({
            street: args.street,
            city: args.city,
            stateOrRegion: args.stateOrRegion ?? args.state ?? "",
            country: args.country,
            postalCode: args.postalCode,
            name: args.name ?? args.fullName,
            phoneNumber: args.phone ?? args.phoneNumber,
            email: args.email,
          })
          .pipe(
            Effect.map((res) => ({ success: true, ...res })),
            Effect.catch((err: unknown) => {
              const msg = extractErrorMessage(err, "Failed to update shipping address.");
              return Effect.succeed({
                success: false,
                error: msg,
              });
            }),
          );
      }),
    ),
);

export const setBillingAddressTool = createAssistantTool(
  setBillingAddressSpec,
  (args: SetAddressArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client
          .updateBillingAddress({
            street: args.street,
            city: args.city,
            stateOrRegion: args.stateOrRegion ?? args.state ?? "",
            country: args.country,
            postalCode: args.postalCode,
            name: args.name ?? args.fullName,
            phoneNumber: args.phone ?? args.phoneNumber,
            email: args.email,
          })
          .pipe(
            Effect.map((res) => ({ success: true, ...res })),
            Effect.catch((err: unknown) => {
              const msg = extractErrorMessage(err, "Failed to update billing address.");
              return Effect.succeed({
                success: false,
                error: msg,
              });
            }),
          );
      }),
    ),
);

export const setEmailTool = createAssistantTool(
  setEmailSpec,
  ({ email }: SetEmailArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.updateEmail({ email }).pipe(
          Effect.map((res) => ({ success: true, ...res })),
          Effect.catch((err: unknown) => {
            const msg = extractErrorMessage(err, "Failed to update email.");
            return Effect.succeed({
              success: false,
              error: msg,
            });
          }),
        );
      }),
    ),
);

export const checkoutCartTool = createAssistantTool(
  checkoutCartSpec,
  (_args: CheckoutCartArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.checkout({}).pipe(
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
            return Effect.succeed({
              success: false,
              error: msg,
              tag,
            });
          }),
        );
      }),
    ),
);

export const getOrderHistoryTool = createAssistantTool(
  getOrderHistorySpec,
  ({ limit }: GetOrderHistoryArgs, { userId }: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
        return yield* client.getOrderHistory({ limit }).pipe(Effect.orDie);
      }),
    ),
);

export const getOrderDetailsTool = createAssistantTool(
  getOrderDetailsSpec,
  ({ orderId }: GetOrderDetailsArgs, _ctx: ToolContext) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* OrderAgent.client.get({ id: orderId }).pipe(Effect.orDie);
        const order = yield* client.get({}).pipe(Effect.orDie);
        return order ?? { error: `Order with ID ${orderId} not found.` };
      }),
    ),
);

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
