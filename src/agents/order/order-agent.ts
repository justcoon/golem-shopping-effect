import { Effect, Ref, Schema } from "effect";
import { defineAgent, Http, method, Snapshot } from "@golemcloud/effect-golem";
import {
  CURRENCY,
  getCurrentDatetime,
  INVENTORY_REGION_DEFAULT,
  orDieRpc,
  PRICING_REGION_DEFAULT,
} from "../../common/index.js";
import { InventoryAgent } from "../inventory/index.js";
import { PricingAgent } from "../pricing/index.js";
import { ProductAgent } from "../product/index.js";
import {
  AddItemError,
  CancelOrderError,
  CreateOrder,
  getOrderItemsTotalPrice,
  InitOrderError,
  Order,
  OrderAgentState,
  OrderItem,
  OrderUpdated,
  RemoveItemError,
  ShipOrderError,
  UpdateAddressError,
  UpdateEmailError,
  UpdateItemQuantityError,
} from "./order-schema.js";

export const OrderAgent = defineAgent({
  name: "OrderAgent",
  mode: "durable",
  id: { id: Schema.String },
  snapshotting: Snapshot.define({
    schema: OrderAgentState,
    policy: Snapshot.policy.everyN(10),
  }),
  http: Http.mount("/v1/order/{id}"),
  methods: {
    create: method({
      input: { order: CreateOrder },
      success: OrderUpdated,
      error: InitOrderError,
      description: "Create order",
    }),
    addItem: method({
      input: {
        productId: Schema.String,
        quantity: Schema.Number,
      },
      success: OrderUpdated,
      error: AddItemError,
      http: [Http.put("/items/{productId}")],
      description: "Add item to order",
    }),
    updateItemQuantity: method({
      input: {
        productId: Schema.String,
        quantity: Schema.Number,
      },
      success: OrderUpdated,
      error: UpdateItemQuantityError,
      description: "Update item quantity in order",
    }),
    removeItem: method({
      input: { productId: Schema.String },
      success: OrderUpdated,
      error: RemoveItemError,
      http: [Http.del("/items/{productId}")],
      description: "Remove item from order",
    }),
    updateBillingAddress: method({
      input: {
        street: Schema.String,
        city: Schema.String,
        stateOrRegion: Schema.String,
        country: Schema.String,
        postalCode: Schema.String,
        name: Schema.optional(Schema.String),
        phoneNumber: Schema.optional(Schema.String),
        email: Schema.optional(Schema.String),
      },
      success: OrderUpdated,
      error: UpdateAddressError,
      http: [Http.put("/billing-address")],
      description: "Update billing address in order",
    }),
    updateShippingAddress: method({
      input: {
        street: Schema.String,
        city: Schema.String,
        stateOrRegion: Schema.String,
        country: Schema.String,
        postalCode: Schema.String,
        name: Schema.optional(Schema.String),
        phoneNumber: Schema.optional(Schema.String),
        email: Schema.optional(Schema.String),
      },
      success: OrderUpdated,
      error: UpdateAddressError,
      http: [Http.put("/shipping-address")],
      description: "Update shipping address in order",
    }),
    updateEmail: method({
      input: { email: Schema.String },
      success: OrderUpdated,
      error: UpdateEmailError,
      http: [Http.put("/email")],
      description: "Update email in order",
    }),
    cancelOrder: method({
      input: {},
      success: OrderUpdated,
      error: CancelOrderError,
      http: [Http.post("/cancel-order")],
      description: "Cancel order",
    }),
    shipOrder: method({
      input: {},
      success: OrderUpdated,
      error: ShipOrderError,
      http: [Http.post("/ship-order")],
      description: "Ship order",
    }),
    get: method({
      input: {},
      success: Schema.NullOr(Order),
      readOnly: true,
      http: [Http.get("/")],
      description:
        "Retrieve comprehensive details for an order including items, delivery address, and status.",
      promptHint:
        "Call this when the user asks for details, status, tracking, or items in a specific order.",
    }),
  },
}).implement<Ref.Ref<OrderAgentState>>({
  init: ({ id }) =>
    Ref.make<OrderAgentState>({
      orderId: id,
      order: null,
    }),
  snapshot: Snapshot.ref<OrderAgentState>(),
  methods: (state) => {
    const getOrCreateOrder = Effect.gen(function* () {
      const { orderId, order } = yield* Ref.get(state);
      if (order) return order;
      const date = yield* getCurrentDatetime;
      const initial: Order = {
        orderId,
        userId: "",
        items: [],
        total: 0,
        currency: CURRENCY,
        orderStatus: "new",
        email: null,
        billingAddress: null,
        shippingAddress: null,
        createdAt: date,
        updatedAt: date,
      };
      yield* Ref.update(state, (curr) => ({ ...curr, order: initial }));
      return initial;
    });

    return {
      create: ({ order }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const current = yield* getOrCreateOrder;
            if (current.orderStatus !== "new" && current.items.length > 0) {
              return yield* Effect.fail({
                _tag: "action-not-allowed" as const,
                message: "Can not update order with orderStatus",
                status: current.orderStatus,
              });
            }

            const region = INVENTORY_REGION_DEFAULT;
            const reservedProductIds: string[] = [];

            for (const item of order.items) {
              const invClient = yield* InventoryAgent.client
                .get({ id: item.productId })
                .pipe(Effect.orDie);
              yield* invClient
                .reserveQuantity({
                  orderId: current.orderId,
                  region,
                  quantity: item.quantity,
                  expiresAt: undefined,
                })
                .pipe(
                  Effect.catchTag("inventory-not-found", (err) =>
                    Effect.fail({
                      _tag: "insufficient-inventory" as const,
                      message: err.message,
                      productId: item.productId,
                      region,
                      requested: item.quantity,
                      available: 0,
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
                            client.releaseReservation.trigger({ orderId: current.orderId }),
                          ),
                          Effect.ignore,
                        ),
                      { concurrency: "unbounded" },
                    ),
                  ),
                );
              reservedProductIds.push(item.productId);
            }

            const date = yield* getCurrentDatetime;
            const updated: Order = {
              ...current,
              userId: order.userId,
              items: [...order.items],
              email: order.email ?? null,
              billingAddress: order.billingAddress ?? null,
              shippingAddress: order.shippingAddress ?? null,
              total: order.total,
              currency: order.currency,
              orderStatus: "new",
              updatedAt: date,
            };
            yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
            return { userId: updated.userId, orderId: updated.orderId };
          }),
        ),

      addItem: ({ productId, quantity }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const current = yield* getOrCreateOrder;
            if (current.orderStatus !== "new") {
              return yield* Effect.fail({
                _tag: "action-not-allowed" as const,
                message: "Can not update order with orderStatus",
                status: current.orderStatus,
              });
            }

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

            // 2. Verify pricing (for new items) before making any inventory reservations
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

            // 3. Verify and reserve inventory (stateful mutation occurs only after product and pricing succeed)
            const region = INVENTORY_REGION_DEFAULT;
            const currentQty = currentItem ? currentItem.quantity : 0;
            const newTotalQty = currentQty + quantity;

            const invClient = yield* InventoryAgent.client
              .get({ id: productId })
              .pipe(Effect.orDie);
            yield* invClient
              .reserveQuantity({
                orderId: current.orderId,
                region,
                quantity: newTotalQty,
                expiresAt: undefined,
              })
              .pipe(
                Effect.catchTag("inventory-not-found", (err) =>
                  Effect.fail({
                    _tag: "insufficient-inventory" as const,
                    message: err.message,
                    productId,
                    region,
                    requested: newTotalQty,
                    available: 0,
                  }),
                ),
                orDieRpc,
              );

            const date = yield* getCurrentDatetime;

            if (existingIndex >= 0) {
              const updatedItems = current.items.map((item, idx) =>
                idx === existingIndex ? { ...item, quantity: newTotalQty } : item,
              );
              const updated: Order = {
                ...current,
                items: updatedItems,
                total: getOrderItemsTotalPrice(updatedItems),
                updatedAt: date,
              };
              yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
              return { userId: updated.userId, orderId: updated.orderId };
            }

            const newItem: OrderItem = {
              productId,
              productName: product.name,
              productBrand: product.brand,
              price,
              quantity,
            };

            const newItems = [...current.items, newItem];
            const updated: Order = {
              ...current,
              items: newItems,
              total: getOrderItemsTotalPrice(newItems),
              updatedAt: date,
            };
            yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
            return { userId: updated.userId, orderId: updated.orderId };
          }),
        ),

      updateItemQuantity: ({ productId, quantity }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const current = yield* getOrCreateOrder;
            if (current.orderStatus !== "new") {
              return yield* Effect.fail({
                _tag: "action-not-allowed" as const,
                message: "Can not update order with orderStatus",
                status: current.orderStatus,
              });
            }

            const existingIndex = current.items.findIndex((item) => item.productId === productId);
            if (existingIndex < 0) {
              return yield* Effect.fail({
                _tag: "item-not-found" as const,
                message: `Item with productId ${productId} not found in order`,
                productId,
              });
            }

            const region = INVENTORY_REGION_DEFAULT;
            const invClient = yield* InventoryAgent.client
              .get({ id: productId })
              .pipe(Effect.orDie);
            yield* invClient
              .reserveQuantity({
                orderId: current.orderId,
                region,
                quantity,
                expiresAt: undefined,
              })
              .pipe(
                Effect.catchTag("inventory-not-found", (err) =>
                  Effect.fail({
                    _tag: "insufficient-inventory" as const,
                    message: err.message,
                    productId,
                    region,
                    requested: quantity,
                    available: 0,
                  }),
                ),
                orDieRpc,
              );

            const date = yield* getCurrentDatetime;
            const updatedItems = current.items.map((item, idx) =>
              idx === existingIndex ? { ...item, quantity } : item,
            );
            const updated: Order = {
              ...current,
              items: updatedItems,
              total: getOrderItemsTotalPrice(updatedItems),
              updatedAt: date,
            };
            yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
            return { userId: updated.userId, orderId: updated.orderId };
          }),
        ),

      removeItem: ({ productId }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const current = yield* getOrCreateOrder;
            if (current.orderStatus !== "new") {
              return yield* Effect.fail({
                _tag: "action-not-allowed" as const,
                message: "Can not update order with orderStatus",
                status: current.orderStatus,
              });
            }

            const newItems = current.items.filter((item) => item.productId !== productId);
            if (newItems.length === current.items.length) {
              return yield* Effect.fail({
                _tag: "item-not-found" as const,
                message: `Item with productId ${productId} not found in order`,
                productId,
              });
            }

            const invClient = yield* InventoryAgent.client
              .get({ id: productId })
              .pipe(Effect.orDie);
            yield* invClient.releaseReservation
              .trigger({ orderId: current.orderId })
              .pipe(Effect.ignore);

            const date = yield* getCurrentDatetime;
            const updated: Order = {
              ...current,
              items: newItems,
              total: getOrderItemsTotalPrice(newItems),
              updatedAt: date,
            };
            yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
            return { userId: updated.userId, orderId: updated.orderId };
          }),
        ),

      updateBillingAddress: (address) =>
        Effect.gen(function* () {
          const current = yield* getOrCreateOrder;
          if (current.orderStatus !== "new") {
            return yield* Effect.fail({
              _tag: "action-not-allowed" as const,
              message: "Can not update order with orderStatus",
              status: current.orderStatus,
            });
          }

          const date = yield* getCurrentDatetime;
          const updated: Order = {
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
            updatedAt: date,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
          return { userId: updated.userId, orderId: updated.orderId };
        }),

      updateShippingAddress: (address) =>
        Effect.gen(function* () {
          const current = yield* getOrCreateOrder;
          if (current.orderStatus !== "new") {
            return yield* Effect.fail({
              _tag: "action-not-allowed" as const,
              message: "Can not update order with orderStatus",
              status: current.orderStatus,
            });
          }

          const date = yield* getCurrentDatetime;
          const updated: Order = {
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
            updatedAt: date,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
          return { userId: updated.userId, orderId: updated.orderId };
        }),

      updateEmail: ({ email }) =>
        Effect.gen(function* () {
          const current = yield* getOrCreateOrder;
          if (current.orderStatus !== "new") {
            return yield* Effect.fail({
              _tag: "action-not-allowed" as const,
              message: "Can not update order with orderStatus",
              status: current.orderStatus,
            });
          }

          const date = yield* getCurrentDatetime;
          const updated: Order = {
            ...current,
            email,
            updatedAt: date,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
          return { userId: updated.userId, orderId: updated.orderId };
        }),

      cancelOrder: () =>
        Effect.scoped(
          Effect.gen(function* () {
            const current = yield* getOrCreateOrder;
            if (current.orderStatus !== "new") {
              return yield* Effect.fail({
                _tag: "action-not-allowed" as const,
                message: "Can not update order with orderStatus",
                status: current.orderStatus,
              });
            }

            for (const item of current.items) {
              const invClient = yield* InventoryAgent.client
                .get({ id: item.productId })
                .pipe(Effect.orDie);
              yield* invClient.releaseReservation
                .trigger({ orderId: current.orderId })
                .pipe(Effect.ignore);
            }

            const date = yield* getCurrentDatetime;
            const updated: Order = {
              ...current,
              orderStatus: "cancelled",
              updatedAt: date,
            };
            yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
            return { userId: updated.userId, orderId: updated.orderId };
          }),
        ),

      shipOrder: () =>
        Effect.scoped(
          Effect.gen(function* () {
            const current = yield* getOrCreateOrder;
            if (current.orderStatus !== "new") {
              return yield* Effect.fail({
                _tag: "action-not-allowed" as const,
                message: "Can not update order with orderStatus",
                status: current.orderStatus,
              });
            }

            for (const item of current.items) {
              const invClient = yield* InventoryAgent.client
                .get({ id: item.productId })
                .pipe(Effect.orDie);
              yield* invClient.fulfillReservation
                .trigger({ orderId: current.orderId })
                .pipe(Effect.ignore);
            }

            const date = yield* getCurrentDatetime;
            const updated: Order = {
              ...current,
              orderStatus: "shipped",
              updatedAt: date,
            };
            yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
            return { userId: updated.userId, orderId: updated.orderId };
          }),
        ),

      get: () => Ref.get(state).pipe(Effect.map(({ order }) => order)),
    };
  },
});
