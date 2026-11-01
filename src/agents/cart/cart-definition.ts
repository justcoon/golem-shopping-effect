import { Schema } from "effect";
import { defineAgent, Http, method } from "@golemcloud/effect-golem";
import { Order } from "../order/order-schema.js";
import {
  AddItemError,
  Cart,
  CartUpdated,
  CheckoutError,
  OrderConfirmation,
  RemoveItemError,
  SavedContactInfo,
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
        productId: Schema.String.annotate({ description: "Product ID to add, e.g. 'ap001'" }),
        quantity: Schema.Number.annotate({
          description: "Quantity to add (positive integer, defaults to 1)",
        }),
      },
      success: CartUpdated,
      error: AddItemError,
      http: [Http.put("/items/{productId}")],
      description: "Add an item with specified quantity to the shopping cart.",
      promptHint: "Use this when the user wants to add a product to their shopping cart.",
    }),
    updateItemQuantity: method({
      input: {
        productId: Schema.String.annotate({ description: "Product ID to update" }),
        quantity: Schema.Number.annotate({ description: "New absolute quantity" }),
      },
      success: CartUpdated,
      error: UpdateItemQuantityError,
      description: "Update quantity for an item in the cart.",
      promptHint: "Use this to change the quantity of an item already in the cart.",
    }),
    removeItem: method({
      input: {
        productId: Schema.String.annotate({ description: "Product ID to remove from cart" }),
      },
      success: CartUpdated,
      error: RemoveItemError,
      http: [Http.del("/items/{productId}")],
      description: "Remove an item from the cart.",
      promptHint:
        "Use this when the user asks to remove or delete a specific item from their cart.",
    }),
    updateBillingAddress: method({
      input: {
        street: Schema.String.annotate({
          description: "Street address including house/apartment number",
        }),
        city: Schema.String.annotate({ description: "City name" }),
        stateOrRegion: Schema.String.annotate({ description: "State, province, or region" }),
        country: Schema.String.annotate({ description: "Country code or name" }),
        postalCode: Schema.String.annotate({ description: "Postal or ZIP code" }),
        name: Schema.optional(Schema.String).annotate({ description: "Recipient full name" }),
        phoneNumber: Schema.optional(Schema.String).annotate({
          description: "Contact phone number",
        }),
        email: Schema.optional(Schema.String).annotate({ description: "Contact email address" }),
      },
      success: CartUpdated,
      error: UpdateAddressError,
      http: [Http.put("/billing-address")],
      description: "Sets the billing address on the customer's shopping cart.",
      promptHint:
        "Call this when the user provides their billing address or updates billing details for checkout.",
    }),
    updateShippingAddress: method({
      input: {
        street: Schema.String.annotate({
          description: "Street address including house/apartment number",
        }),
        city: Schema.String.annotate({ description: "City name" }),
        stateOrRegion: Schema.String.annotate({ description: "State, province, or region" }),
        country: Schema.String.annotate({ description: "Country code or name" }),
        postalCode: Schema.String.annotate({ description: "Postal or ZIP code" }),
        name: Schema.optional(Schema.String).annotate({ description: "Recipient full name" }),
        phoneNumber: Schema.optional(Schema.String).annotate({
          description: "Contact phone number",
        }),
        email: Schema.optional(Schema.String).annotate({ description: "Contact email address" }),
      },
      success: CartUpdated,
      error: UpdateAddressError,
      http: [Http.put("/shipping-address")],
      description: "Sets the shipping address on the customer's shopping cart.",
      promptHint:
        "Call this when the user provides their shipping or delivery address for an order.",
    }),
    updateEmail: method({
      input: {
        email: Schema.String.annotate({ description: "Customer contact email address" }),
      },
      success: CartUpdated,
      error: UpdateEmailError,
      http: [Http.put("/email")],
      description: "Update the contact email on the shopping cart.",
      promptHint:
        "Call this when the user specifies or updates their email address for order notifications.",
    }),
    checkout: method({
      input: {},
      success: OrderConfirmation,
      error: CheckoutError,
      http: [Http.post("/checkout")],
      description: "Places the order by checking out the current shopping cart.",
      promptHint:
        "Call this to complete checkout and create the order after shipping address and contact info are confirmed.",
    }),
    clear: method({
      input: {},
      success: Schema.Void,
      description: "Empties all items and resets addresses in the customer's shopping cart.",
      promptHint:
        "Call this when the user explicitly requests to empty or clear their entire shopping cart.",
    }),
    get: method({
      input: {},
      success: Schema.NullOr(Cart),
      http: [Http.get("/")],
      description:
        "Retrieves the customer's current shopping cart, including items, totals, and addresses.",
      promptHint:
        "Call this to inspect cart contents, check items, prices, or verify subtotal/totals.",
    }),
    getSavedContactInfo: method({
      input: {},
      success: Schema.NullOr(SavedContactInfo),
      http: [Http.get("/saved-contact")],
      description:
        "Retrieves previously saved contact information and addresses from the user's past orders.",
      promptHint:
        "Call this before checkout to check if the user has saved shipping/billing details from previous orders.",
    }),
    applySavedContactInfo: method({
      input: {},
      success: CartUpdated,
      error: UpdateAddressError,
      http: [Http.post("/use-saved-contact")],
      description:
        "Applies saved contact details and addresses from previous orders to the current cart.",
      promptHint:
        "Call this when the user confirms they want to use their saved address and contact info for 1-click checkout.",
    }),
    getOrderHistory: method({
      input: {
        limit: Schema.optional(Schema.Number).annotate({
          description: "Maximum number of recent orders to return (defaults to 10)",
        }),
      },
      success: Schema.Array(Order),
      http: [Http.get("/orders?limit={limit}")],
      description: "Retrieves past orders placed by this customer.",
      promptHint:
        "Call this when the user asks about their previous orders, order history, or recent purchases.",
    }),
  },
});
