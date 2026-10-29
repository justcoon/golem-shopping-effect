import { Effect, Ref } from "effect";
import { CURRENCY, getCurrentDatetime, PRICING_REGION_DEFAULT } from "../../common/index.js";
import { OrderAgent } from "../order/index.js";
import { PricingAgent } from "../pricing/index.js";
import { ProductAgent } from "../product/index.js";
import { ShoppingAssistantDefinition } from "../shopping-assistant/shopping-assistant-definition.js";
import { CartAgentDefinition } from "./cart-definition.js";
import { Cart, CartItem, getCartItemsTotalPrice } from "./cart-schema.js";

interface CartAgentState {
  readonly userId: string;
  readonly cart: Cart | null;
}

export const CartAgent = CartAgentDefinition.implement({
  init: ({ id }) =>
    Ref.make<CartAgentState>({
      userId: id,
      cart: null,
    }),
  methods: (state) => {
    const getOrCreateCart = Effect.gen(function* () {
      const { userId, cart } = yield* Ref.get(state);
      if (cart) return cart;
      const date = yield* getCurrentDatetime;
      const initial: Cart = {
        userId,
        items: [],
        total: 0,
        currency: CURRENCY,
        previousOrderIds: [],
        updatedAt: date,
      };
      yield* Ref.update(state, (curr) => ({ ...curr, cart: initial }));
      return initial;
    });

    return {
      addItem: ({ productId, quantity }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const current = yield* getOrCreateCart;
            const existingIndex = current.items.findIndex((item) => item.productId === productId);

            const date = yield* getCurrentDatetime;

            if (existingIndex >= 0) {
              const updatedItems = current.items.map((item, idx) =>
                idx === existingIndex ? { ...item, quantity: item.quantity + quantity } : item,
              );
              const updated: Cart = {
                ...current,
                items: updatedItems,
                total: getCartItemsTotalPrice(updatedItems),
                updatedAt: date,
              };
              yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
              return { userId: current.userId };
            }

            const productClient = yield* ProductAgent.client
              .get({ id: productId })
              .pipe(Effect.orDie);
            const product = yield* productClient.get({}).pipe(Effect.orDie);
            if (!product) {
              return yield* Effect.fail({
                _tag: "product-not-found" as const,
                message: `Product with productId ${productId} not found`,
                productId,
              });
            }

            const pricingClient = yield* PricingAgent.client
              .get({ id: productId })
              .pipe(Effect.orDie);
            const pricing = yield* pricingClient
              .getPrice({
                currency: current.currency,
                region: PRICING_REGION_DEFAULT,
              })
              .pipe(Effect.orDie);

            if (!pricing) {
              return yield* Effect.fail({
                _tag: "pricing-not-found" as const,
                message: `Pricing for product with productId ${productId} not found`,
                productId,
              });
            }

            const newItem: CartItem = {
              productId,
              productName: product.name,
              productBrand: product.brand,
              price: pricing.price,
              quantity,
            };

            const newItems = [...current.items, newItem];
            const updated: Cart = {
              ...current,
              items: newItems,
              total: getCartItemsTotalPrice(newItems),
              updatedAt: date,
            };
            yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
            return { userId: current.userId };
          }),
        ),

      updateItemQuantity: ({ productId, quantity }) =>
        Effect.gen(function* () {
          const current = yield* getOrCreateCart;
          const existingIndex = current.items.findIndex((item) => item.productId === productId);
          if (existingIndex < 0) {
            return yield* Effect.fail({
              _tag: "item-not-found" as const,
              message: `Item with productId ${productId} not found in cart`,
              productId,
            });
          }

          const date = yield* getCurrentDatetime;
          const updatedItems = current.items.map((item, idx) =>
            idx === existingIndex ? { ...item, quantity } : item,
          );
          const updated: Cart = {
            ...current,
            items: updatedItems,
            total: getCartItemsTotalPrice(updatedItems),
            updatedAt: date,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
          return { userId: current.userId };
        }),

      removeItem: ({ productId }) =>
        Effect.gen(function* () {
          const current = yield* getOrCreateCart;
          const newItems = current.items.filter((item) => item.productId !== productId);
          if (newItems.length === current.items.length) {
            return yield* Effect.fail({
              _tag: "item-not-found" as const,
              message: `Item with productId ${productId} not found in cart`,
              productId,
            });
          }

          const date = yield* getCurrentDatetime;
          const updated: Cart = {
            ...current,
            items: newItems,
            total: getCartItemsTotalPrice(newItems),
            updatedAt: date,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
          return { userId: current.userId };
        }),

      updateBillingAddress: (address) =>
        Effect.gen(function* () {
          const current = yield* getOrCreateCart;
          const date = yield* getCurrentDatetime;
          const updated: Cart = {
            ...current,
            billingAddress: {
              street: address.street,
              city: address.city,
              stateOrRegion: address.stateOrRegion,
              country: address.country,
              postalCode: address.postalCode,
              name: address.name,
              phoneNumber: address.phoneNumber,
            },
            updatedAt: date,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
          return { userId: current.userId };
        }),

      updateShippingAddress: (address) =>
        Effect.gen(function* () {
          const current = yield* getOrCreateCart;
          const date = yield* getCurrentDatetime;
          const updated: Cart = {
            ...current,
            shippingAddress: {
              street: address.street,
              city: address.city,
              stateOrRegion: address.stateOrRegion,
              country: address.country,
              postalCode: address.postalCode,
              name: address.name,
              phoneNumber: address.phoneNumber,
            },
            updatedAt: date,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
          return { userId: current.userId };
        }),

      updateEmail: ({ email }) =>
        Effect.gen(function* () {
          const current = yield* getOrCreateCart;
          const date = yield* getCurrentDatetime;
          const updated: Cart = {
            ...current,
            email,
            updatedAt: date,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
          return { userId: current.userId };
        }),

      checkout: () =>
        Effect.scoped(
          Effect.gen(function* () {
            const current = yield* getOrCreateCart;

            if (current.items.length === 0) {
              return yield* Effect.fail({
                _tag: "empty-items" as const,
                message: "Cart is empty",
              });
            }
            if (!current.email) {
              return yield* Effect.fail({
                _tag: "empty-email" as const,
                message: "Email is empty",
              });
            }
            if (!current.billingAddress) {
              return yield* Effect.fail({
                _tag: "billing-address-not-set" as const,
                message: "Billing address is not set",
              });
            }

            const orderId = crypto.randomUUID();
            const orderClient = yield* OrderAgent.client.get({ id: orderId }).pipe(Effect.orDie);

            const createResult = yield* orderClient
              .create({
                order: {
                  userId: current.userId,
                  items: current.items,
                  email: current.email,
                  billingAddress: current.billingAddress,
                  shippingAddress: current.shippingAddress,
                  total: current.total,
                  currency: current.currency,
                  updatedAt: current.updatedAt,
                },
              })
              .pipe(
                Effect.map(() => true),
                Effect.catch(() => Effect.succeed(false)),
              );

            if (!createResult) {
              return yield* Effect.fail({
                _tag: "order-create" as const,
                message: "Order creation failed",
              });
            }

            const date = yield* getCurrentDatetime;
            const updated: Cart = {
              ...current,
              items: [],
              total: 0,
              billingAddress: undefined,
              shippingAddress: undefined,
              previousOrderIds: [...current.previousOrderIds, orderId],
              updatedAt: date,
            };
            yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));

            // Fire and forget recommendation trigger
            const assistantClient = yield* ShoppingAssistantDefinition.client
              .get({ id: current.userId })
              .pipe(Effect.orDie);
            yield* assistantClient.recommendItems.trigger({}).pipe(Effect.catch(() => Effect.void));

            return { userId: current.userId, orderId };
          }),
        ),

      clear: () =>
        Effect.gen(function* () {
          const current = yield* getOrCreateCart;
          const date = yield* getCurrentDatetime;
          yield* Ref.update(state, (curr) => ({
            ...curr,
            cart: {
              ...current,
              items: [],
              total: 0,
              billingAddress: undefined,
              shippingAddress: undefined,
              updatedAt: date,
            },
          }));
        }),

      get: () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { cart } = yield* Ref.get(state);
            if (!cart || cart.items.length === 0) {
              return cart;
            }

            const refreshedItems: CartItem[] = [];

            for (const item of cart.items) {
              const productClient = yield* ProductAgent.client
                .get({ id: item.productId })
                .pipe(Effect.orDie);
              const product = yield* productClient.get({}).pipe(Effect.orDie);

              const pricingClient = yield* PricingAgent.client
                .get({ id: item.productId })
                .pipe(Effect.orDie);
              const pricing = yield* pricingClient
                .getPrice({
                  currency: cart.currency,
                  region: PRICING_REGION_DEFAULT,
                })
                .pipe(Effect.orDie);

              if (product && pricing) {
                refreshedItems.push({
                  productId: item.productId,
                  productName: product.name,
                  productBrand: product.brand,
                  price: pricing.price,
                  quantity: item.quantity,
                });
              }
            }

            const date = yield* getCurrentDatetime;
            const updatedCart: Cart = {
              ...cart,
              items: refreshedItems,
              total: getCartItemsTotalPrice(refreshedItems),
              updatedAt: date,
            };

            yield* Ref.update(state, (curr) => ({
              ...curr,
              cart: updatedCart,
            }));
            return updatedCart;
          }),
        ),
    };
  },
});
