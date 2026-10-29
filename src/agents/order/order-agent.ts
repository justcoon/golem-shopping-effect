import { Effect, Ref, Schema } from "effect";
import { defineAgent, Http, method } from "@golemcloud/effect-golem";
import { CURRENCY, getCurrentDatetime, PRICING_REGION_DEFAULT } from "../../common/index.js";
import { PricingAgent } from "../pricing/index.js";
import { ProductAgent } from "../product/index.js";
import {
  AddItemError,
  CancelOrderError,
  CreateOrder,
  getOrderItemsTotalPrice,
  InitOrderError,
  Order,
  OrderItem,
  OrderUpdated,
  RemoveItemError,
  ShipOrderError,
  UpdateAddressError,
  UpdateEmailError,
  UpdateItemQuantityError,
} from "./order-schema.js";

interface OrderAgentState {
  readonly orderId: string;
  readonly order: Order | null;
}

export const OrderAgent = defineAgent({
  name: "OrderAgent",
  mode: "durable",
  id: { id: Schema.String },
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
      description: "Get order",
    }),
  },
}).implement({
  init: ({ id }) =>
    Ref.make<OrderAgentState>({
      orderId: id,
      order: null,
    }),
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
        email: undefined,
        billingAddress: undefined,
        shippingAddress: undefined,
        createdAt: date,
        updatedAt: date,
      };
      yield* Ref.update(state, (curr) => ({ ...curr, order: initial }));
      return initial;
    });

    return {
      create: ({ order }) =>
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
            userId: order.userId,
            items: [...order.items],
            email: order.email,
            billingAddress: order.billingAddress,
            shippingAddress: order.shippingAddress,
            total: order.total,
            currency: order.currency,
            orderStatus: "new",
            updatedAt: date,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
          return { userId: updated.userId, orderId: updated.orderId };
        }),

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

            const existingIndex = current.items.findIndex((item) => item.productId === productId);

            const date = yield* getCurrentDatetime;

            if (existingIndex >= 0) {
              const updatedItems = current.items.map((item, idx) =>
                idx === existingIndex ? { ...item, quantity: item.quantity + quantity } : item,
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

            const newItem: OrderItem = {
              productId,
              productName: product.name,
              productBrand: product.brand,
              price: pricing.price,
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

      removeItem: ({ productId }) =>
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
              name: address.name,
              phoneNumber: address.phoneNumber,
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
              name: address.name,
              phoneNumber: address.phoneNumber,
            },
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
            orderStatus: "cancelled",
            updatedAt: date,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
          return { userId: updated.userId, orderId: updated.orderId };
        }),

      shipOrder: () =>
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
            orderStatus: "shipped",
            updatedAt: date,
          };
          yield* Ref.update(state, (curr) => ({ ...curr, order: updated }));
          return { userId: updated.userId, orderId: updated.orderId };
        }),

      get: () => Ref.get(state).pipe(Effect.map(({ order }) => order)),
    };
  },
});
