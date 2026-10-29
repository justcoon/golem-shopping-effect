import { Schema } from "effect";
import { defineAgent, Http, method } from "@golemcloud/effect-golem";
import {
  AddItemError,
  Cart,
  CartUpdated,
  CheckoutError,
  OrderConfirmation,
  RemoveItemError,
  UpdateAddressError,
  UpdateEmailError,
  UpdateItemQuantityError,
} from "./cart-schema.js";

export const CartAgentDefinition = defineAgent({
  name: "CartAgent",
  mode: "durable",
  id: { id: Schema.String },
  http: Http.mount("/v1/cart/{id}"),
  methods: {
    addItem: method({
      input: {
        productId: Schema.String,
        quantity: Schema.Number,
      },
      success: CartUpdated,
      error: AddItemError,
      http: [Http.put("/items/{productId}")],
      description: "Add item to cart",
    }),
    updateItemQuantity: method({
      input: {
        productId: Schema.String,
        quantity: Schema.Number,
      },
      success: CartUpdated,
      error: UpdateItemQuantityError,
      description: "Update item quantity in cart",
    }),
    removeItem: method({
      input: { productId: Schema.String },
      success: CartUpdated,
      error: RemoveItemError,
      http: [Http.del("/items/{productId}")],
      description: "Remove item from cart",
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
      success: CartUpdated,
      error: UpdateAddressError,
      http: [Http.put("/billing-address")],
      description: "Update billing address in cart",
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
      success: CartUpdated,
      error: UpdateAddressError,
      http: [Http.put("/shipping-address")],
      description: "Update shipping address in cart",
    }),
    updateEmail: method({
      input: { email: Schema.String },
      success: CartUpdated,
      error: UpdateEmailError,
      http: [Http.put("/email")],
      description: "Update email in cart",
    }),
    checkout: method({
      input: {},
      success: OrderConfirmation,
      error: CheckoutError,
      http: [Http.post("/checkout")],
      description: "Checkout cart",
    }),
    clear: method({
      input: {},
      success: Schema.Void,
      description: "Clear cart content",
    }),
    get: method({
      input: {},
      success: Schema.NullOr(Cart),
      http: [Http.get("/")],
      description: "Get cart",
    }),
  },
});

