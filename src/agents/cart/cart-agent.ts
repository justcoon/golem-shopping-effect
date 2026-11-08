import { DateTime, Duration, Effect, Ref } from "effect";
import {
  arrayChunks,
  CHECKOUT_RESERVATION_TTL_SECONDS,
  CURRENCY,
  getCurrentDatetime,
  INVENTORY_REGION_DEFAULT,
  orDieRpc,
  PRICING_REGION_DEFAULT,
} from "../../common/index.js";
import { InventoryAgent } from "../inventory/index.js";
import { Order, OrderAgent } from "../order/index.js";
import { PricingAgent } from "../pricing/index.js";
import { ProductAgent } from "../product/index.js";
import { ShoppingRecommendationDefinition } from "../shopping-recommendation/shopping-recommendation-definition.js";
import { CartAgentDefinition } from "./cart-definition.js";
import { Cart, CartItem, CheckoutDraft, getCartItemsTotalPrice } from "./cart-schema.js";

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
      const now = yield* getCurrentDatetime;
      const initial: Cart = {
        userId,
        items: [],
        email: null,
        billingAddress: null,
        shippingAddress: null,
        total: 0,
        currency: CURRENCY,
        previousOrderIds: [],
        updatedAt: now,
        draft: null,
      };
      yield* Ref.update(state, (curr) => ({ ...curr, cart: initial }));
      return initial;
    });

    const purgeExpiredDraft = (cart: Cart, now: DateTime.Utc): Cart => {
      if (
        cart.draft &&
        DateTime.toEpochMillis(cart.draft.expiresAt) <= DateTime.toEpochMillis(now)
      ) {
        return {
          ...cart,
          draft: null,
          updatedAt: now,
        };
      }
      return cart;
    };

    const isInCheckout = (cart: Cart, now: DateTime.Utc): boolean => {
      if (!cart.draft) return false;
      return DateTime.toEpochMillis(cart.draft.expiresAt) > DateTime.toEpochMillis(now);
    };

    const ensureModifiable = (now: DateTime.Utc) =>
      Effect.gen(function* () {
        const cart = yield* getOrCreateCart;
        const purged = purgeExpiredDraft(cart, now);
        if (purged !== cart) {
          yield* Ref.update(state, (curr) => ({ ...curr, cart: purged }));
        }
        if (purged.draft) {
          return yield* Effect.fail({
            _tag: "action-not-allowed" as const,
            message: `Cannot modify cart while checkout is in progress for order #${purged.draft.orderId}. Please confirm or cancel the active checkout first.`,
          });
        }
        return purged;
      });

    return {
      addItem: ({ productId, quantity }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const now = yield* getCurrentDatetime;
            const current = yield* ensureModifiable(now);

            // 1. Check if product exists first
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

            const existingIndex = current.items.findIndex((item) => item.productId === productId);
            const currentItem = existingIndex >= 0 ? current.items[existingIndex] : undefined;

            // 2. Check pricing for new item before checking inventory
            let price = currentItem?.price;
            if (price === undefined) {
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
              price = pricing.price;
            }

            // 3. Check inventory availability
            const currentItemQuantity = currentItem ? currentItem.quantity : 0;
            const requestedTotalQuantity = currentItemQuantity + quantity;

            const targetRegion = INVENTORY_REGION_DEFAULT;
            const inventoryClient = yield* InventoryAgent.client
              .get({ id: productId })
              .pipe(Effect.orDie);
            const availability = yield* inventoryClient
              .getAvailableQuantity({ region: targetRegion })
              .pipe(Effect.orDie);

            if (availability.availableQuantity < requestedTotalQuantity) {
              return yield* Effect.fail({
                _tag: "insufficient-stock" as const,
                message: `Insufficient stock for product ${productId} in region ${targetRegion}. Requested: ${requestedTotalQuantity}, available: ${availability.availableQuantity}`,
                productId,
                region: targetRegion,
                requested: requestedTotalQuantity,
                available: availability.availableQuantity,
              });
            }

            if (existingIndex >= 0) {
              const updatedItems = current.items.map((item, idx) =>
                idx === existingIndex ? { ...item, quantity: requestedTotalQuantity } : item,
              );
              const updated: Cart = {
                ...current,
                items: updatedItems,
                total: getCartItemsTotalPrice(updatedItems),
                updatedAt: now,
              };
              yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
              return { userId: current.userId };
            }

            const newItem: CartItem = {
              productId,
              productName: product.name,
              productBrand: product.brand,
              price,
              quantity,
            };

            const newItems = [...current.items, newItem];
            const updated: Cart = {
              ...current,
              items: newItems,
              total: getCartItemsTotalPrice(newItems),
              updatedAt: now,
            };
            yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
            return { userId: current.userId };
          }),
        ),

      updateItemQuantity: ({ productId, quantity }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const now = yield* getCurrentDatetime;
            const current = yield* ensureModifiable(now);
            const existingIndex = current.items.findIndex((item) => item.productId === productId);
            if (existingIndex < 0) {
              return yield* Effect.fail({
                _tag: "item-not-found" as const,
                message: `Item with productId ${productId} not found in cart`,
                productId,
              });
            }

            const targetRegion = INVENTORY_REGION_DEFAULT;
            const inventoryClient = yield* InventoryAgent.client
              .get({ id: productId })
              .pipe(Effect.orDie);
            const availability = yield* inventoryClient
              .getAvailableQuantity({ region: targetRegion })
              .pipe(Effect.orDie);

            if (availability.availableQuantity < quantity) {
              return yield* Effect.fail({
                _tag: "insufficient-stock" as const,
                message: `Insufficient stock for product ${productId} in region ${targetRegion}. Requested: ${quantity}, available: ${availability.availableQuantity}`,
                productId,
                region: targetRegion,
                requested: quantity,
                available: availability.availableQuantity,
              });
            }

            const updatedItems = current.items.map((item, idx) =>
              idx === existingIndex ? { ...item, quantity } : item,
            );
            const updated: Cart = {
              ...current,
              items: updatedItems,
              total: getCartItemsTotalPrice(updatedItems),
              updatedAt: now,
            };
            yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
            return { userId: current.userId };
          }),
        ),

      removeItem: ({ productId }) =>
        Effect.gen(function* () {
          const now = yield* getCurrentDatetime;
          const current = yield* ensureModifiable(now);
          const newItems = current.items.filter((item) => item.productId !== productId);
          if (newItems.length === current.items.length) {
            return yield* Effect.fail({
              _tag: "item-not-found" as const,
              message: `Item with productId ${productId} not found in cart`,
              productId,
            });
          }

          const updated: Cart = {
            ...current,
            items: newItems,
            total: getCartItemsTotalPrice(newItems),
            updatedAt: now,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
          return { userId: current.userId };
        }),

      updateBillingAddress: (address) =>
        Effect.gen(function* () {
          const now = yield* getCurrentDatetime;
          const current = yield* ensureModifiable(now);
          const updated: Cart = {
            ...current,
            billingAddress: {
              street: address.street,
              city: address.city,
              stateOrRegion: address.stateOrRegion,
              country: address.country,
              postalCode: address.postalCode,
              name: address.name ?? null,
              phoneNumber: address.phoneNumber ?? null,
              email: address.email ?? null,
            },
            updatedAt: now,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
          return { userId: current.userId };
        }),

      updateShippingAddress: (address) =>
        Effect.gen(function* () {
          const now = yield* getCurrentDatetime;
          const current = yield* ensureModifiable(now);
          const updated: Cart = {
            ...current,
            shippingAddress: {
              street: address.street,
              city: address.city,
              stateOrRegion: address.stateOrRegion,
              country: address.country,
              postalCode: address.postalCode,
              name: address.name ?? null,
              phoneNumber: address.phoneNumber ?? null,
              email: address.email ?? null,
            },
            email: current.email ?? address.email ?? null,
            updatedAt: now,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
          return { userId: current.userId };
        }),

      updateEmail: ({ email }) =>
        Effect.gen(function* () {
          const now = yield* getCurrentDatetime;
          const current = yield* ensureModifiable(now);
          const updated: Cart = {
            ...current,
            email,
            updatedAt: now,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
          return { userId: current.userId };
        }),

      prepareCheckout: () =>
        Effect.scoped(
          Effect.gen(function* () {
            const now = yield* getCurrentDatetime;
            const current = yield* ensureModifiable(now);

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
            const expiresAt = DateTime.addDuration(
              now,
              Duration.seconds(CHECKOUT_RESERVATION_TTL_SECONDS),
            );

            const region = INVENTORY_REGION_DEFAULT;
            const reservedProductIds: string[] = [];

            for (const item of current.items) {
              const invClient = yield* InventoryAgent.client
                .get({ id: item.productId })
                .pipe(Effect.orDie);
              yield* invClient
                .reserveQuantity({
                  orderId,
                  region,
                  quantity: item.quantity,
                  expiresAt,
                })
                .pipe(
                  Effect.catchTag("inventory-not-found", (err) =>
                    Effect.fail({
                      _tag: "insufficient-stock" as const,
                      message: err.message,
                      productId: item.productId,
                      region,
                      requested: item.quantity,
                      available: 0,
                    }),
                  ),
                  Effect.catchTag("insufficient-inventory", (err) =>
                    Effect.fail({
                      _tag: "insufficient-stock" as const,
                      message: err.message,
                      productId: err.productId,
                      region: err.region,
                      requested: err.requested,
                      available: err.available,
                    }),
                  ),
                  orDieRpc,
                  Effect.tapError(() =>
                    Effect.forEach(
                      reservedProductIds,
                      (pid) =>
                        InventoryAgent.client.get({ id: pid }).pipe(
                          Effect.orDie,
                          Effect.andThen((client) =>
                            client.releaseReservation.trigger({ orderId }),
                          ),
                          Effect.ignore,
                        ),
                      { concurrency: "unbounded" },
                    ),
                  ),
                );
              reservedProductIds.push(item.productId);
            }

            const draft: CheckoutDraft = {
              orderId,
              expiresAt,
              createdAt: now,
            };

            const updatedCart: Cart = {
              ...current,
              draft,
              updatedAt: now,
            };

            yield* Ref.update(state, (curr) => ({ ...curr, cart: updatedCart }));
            return updatedCart;
          }),
        ),

      confirmCheckout: ({ orderId }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const current = yield* getOrCreateCart;
            const now = yield* getCurrentDatetime;

            if (!current.draft) {
              return yield* Effect.fail({
                _tag: "no-active-draft" as const,
                message: "No active checkout draft found. Please prepare checkout first.",
              });
            }

            if (current.draft.orderId !== orderId) {
              return yield* Effect.fail({
                _tag: "order-mismatch" as const,
                message: `Requested orderId ${orderId} does not match active draft ${current.draft.orderId}`,
              });
            }

            if (DateTime.toEpochMillis(current.draft.expiresAt) <= DateTime.toEpochMillis(now)) {
              yield* Ref.update(state, (curr) => ({
                ...curr,
                cart: curr.cart ? { ...curr.cart, draft: null, updatedAt: now } : null,
              }));
              return yield* Effect.fail({
                _tag: "reservation-expired" as const,
                message: "The checkout reservation has expired. Please prepare checkout again.",
              });
            }

            const orderClient = yield* OrderAgent.client.get({ id: orderId }).pipe(Effect.orDie);
            yield* orderClient
              .create({
                order: {
                  userId: current.userId,
                  items: current.items,
                  email: current.email!,
                  billingAddress: current.billingAddress!,
                  shippingAddress: current.shippingAddress ?? undefined,
                  total: current.total,
                  currency: current.currency,
                  updatedAt: now,
                },
              })
              .pipe(
                Effect.catchTag("insufficient-inventory", (invErr) =>
                  Effect.fail({
                    _tag: "insufficient-stock" as const,
                    message: invErr.message,
                    productId: invErr.productId,
                    region: invErr.region,
                    requested: invErr.requested,
                    available: invErr.available,
                  }),
                ),
                Effect.catch((err) =>
                  Effect.fail({
                    _tag: "order-create" as const,
                    message: "message" in err ? String(err.message) : "Order creation failed",
                  }),
                ),
              );

            for (const item of current.items) {
              const invClient = yield* InventoryAgent.client
                .get({ id: item.productId })
                .pipe(Effect.orDie);
              yield* invClient.fulfillReservation.trigger({ orderId }).pipe(Effect.ignore);
            }

            const updatedCart: Cart = {
              ...current,
              items: [],
              total: 0,
              billingAddress: null,
              shippingAddress: null,
              draft: null,
              previousOrderIds: [...current.previousOrderIds, orderId],
              updatedAt: now,
            };

            yield* Ref.update(state, (curr) => ({ ...curr, cart: updatedCart }));

            const recommendationClient = yield* ShoppingRecommendationDefinition.client
              .get({ id: current.userId })
              .pipe(Effect.orDie);
            yield* recommendationClient.recommendItems
              .trigger({})
              .pipe(Effect.catch(() => Effect.void));

            return { userId: current.userId, orderId };
          }),
        ),

      cancelCheckout: ({ orderId }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { cart } = yield* Ref.get(state);
            if (cart && cart.draft && cart.draft.orderId === orderId) {
              for (const item of cart.items) {
                const invClient = yield* InventoryAgent.client
                  .get({ id: item.productId })
                  .pipe(Effect.orDie);
                yield* invClient.releaseReservation.trigger({ orderId }).pipe(Effect.ignore);
              }
              const now = yield* getCurrentDatetime;
              yield* Ref.update(state, (curr) => ({
                ...curr,
                cart: curr.cart
                  ? {
                      ...curr.cart,
                      draft: null,
                      updatedAt: now,
                    }
                  : null,
              }));
            }
          }),
        ),

      clear: () =>
        Effect.gen(function* () {
          const now = yield* getCurrentDatetime;
          const modifiable = yield* ensureModifiable(now).pipe(
            Effect.catchTag("action-not-allowed", () => Effect.succeed(null)),
          );
          if (!modifiable) return;
          yield* Ref.update(state, (curr) => ({
            ...curr,
            cart: {
              ...modifiable,
              items: [],
              total: 0,
              billingAddress: null,
              shippingAddress: null,
              updatedAt: now,
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

            const now = yield* getCurrentDatetime;
            const activeCart = purgeExpiredDraft(cart, now);
            if (activeCart !== cart) {
              yield* Ref.update(state, (curr) => ({ ...curr, cart: activeCart }));
            }

            if (isInCheckout(activeCart, now)) {
              return activeCart;
            }

            const refreshedItems: CartItem[] = [];

            for (const item of activeCart.items) {
              const productClient = yield* ProductAgent.client
                .get({ id: item.productId })
                .pipe(Effect.orDie);
              const product = yield* productClient.get({}).pipe(Effect.orDie);

              const pricingClient = yield* PricingAgent.client
                .get({ id: item.productId })
                .pipe(Effect.orDie);
              const pricing = yield* pricingClient
                .getPrice({
                  currency: activeCart.currency,
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

            const updatedCart: Cart = {
              ...activeCart,
              items: refreshedItems,
              total: getCartItemsTotalPrice(refreshedItems),
              updatedAt: now,
            };

            yield* Ref.update(state, (curr) => ({
              ...curr,
              cart: updatedCart,
            }));
            return updatedCart;
          }),
        ),

      getSavedContactInfo: () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { cart } = yield* Ref.get(state);
            if (!cart || cart.previousOrderIds.length === 0) {
              return null;
            }
            const lastOrderId = cart.previousOrderIds[cart.previousOrderIds.length - 1];
            if (!lastOrderId) {
              return null;
            }
            const orderClient = yield* OrderAgent.client
              .get({ id: lastOrderId })
              .pipe(Effect.orDie);
            const order = yield* orderClient.get({}).pipe(Effect.orDie);
            if (!order) {
              return null;
            }
            return {
              shippingAddress: order.shippingAddress ?? null,
              billingAddress: order.billingAddress ?? null,
              email: order.email ?? null,
              sourceOrderId: lastOrderId,
            };
          }),
        ),

      applySavedContactInfo: () =>
        Effect.scoped(
          Effect.gen(function* () {
            const now = yield* getCurrentDatetime;
            const current = yield* ensureModifiable(now);
            if (current.previousOrderIds.length === 0) {
              return yield* Effect.fail({
                _tag: "address-not-valid" as const,
                message: "No previous orders found to apply saved contact info",
              });
            }
            const lastOrderId = current.previousOrderIds[current.previousOrderIds.length - 1];
            if (!lastOrderId) {
              return yield* Effect.fail({
                _tag: "address-not-valid" as const,
                message: "No valid previous order ID found",
              });
            }
            const orderClient = yield* OrderAgent.client
              .get({ id: lastOrderId })
              .pipe(Effect.orDie);
            const order = yield* orderClient.get({}).pipe(Effect.orDie);
            if (!order) {
              return yield* Effect.fail({
                _tag: "address-not-valid" as const,
                message: `Previous order ${lastOrderId} could not be retrieved`,
              });
            }
            const updated: Cart = {
              ...current,
              shippingAddress: order.shippingAddress ?? current.shippingAddress,
              billingAddress: order.billingAddress ?? current.billingAddress,
              email: order.email ?? current.email,
              updatedAt: now,
            };
            yield* Ref.update(state, (curr) => ({ ...curr, cart: updated }));
            return { userId: current.userId };
          }),
        ),

      getOrderHistory: ({ limit }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { cart } = yield* Ref.get(state);
            if (!cart || cart.previousOrderIds.length === 0) {
              return [];
            }
            const maxCount = limit !== undefined && limit > 0 ? limit : 10;
            const orderIds = [...cart.previousOrderIds].reverse().slice(0, maxCount);
            const idChunks = arrayChunks(orderIds, 5);
            const result: Order[] = [];
            for (const chunk of idChunks) {
              const effects = chunk.map((orderId) =>
                Effect.gen(function* () {
                  const client = yield* OrderAgent.client.get({ id: orderId }).pipe(Effect.orDie);
                  return yield* client.get({}).pipe(Effect.orDie);
                }),
              );
              const orders = yield* Effect.all(effects, { concurrency: "unbounded" });
              for (const order of orders) {
                if (order) {
                  result.push(order);
                }
              }
            }
            return result;
          }),
        ),
    };
  },
});
