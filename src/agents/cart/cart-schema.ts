import { Schema } from "effect";
import { Datetime } from "@golemcloud/effect-golem";
import { Address } from "../../common/index.js";

export const ProductNotFoundError = Schema.Struct({
  _tag: Schema.Literal("product-not-found"),
  message: Schema.String,
  productId: Schema.String,
});
export type ProductNotFoundError = typeof ProductNotFoundError.Type;

export const PricingNotFoundError = Schema.Struct({
  _tag: Schema.Literal("pricing-not-found"),
  message: Schema.String,
  productId: Schema.String,
});
export type PricingNotFoundError = typeof PricingNotFoundError.Type;

export const ItemNotFoundError = Schema.Struct({
  _tag: Schema.Literal("item-not-found"),
  message: Schema.String,
  productId: Schema.String,
});
export type ItemNotFoundError = typeof ItemNotFoundError.Type;

export const AddressNotValidError = Schema.Struct({
  _tag: Schema.Literal("address-not-valid"),
  message: Schema.String,
});
export type AddressNotValidError = typeof AddressNotValidError.Type;

export const EmailNotValidError = Schema.Struct({
  _tag: Schema.Literal("email-not-valid"),
  message: Schema.String,
});
export type EmailNotValidError = typeof EmailNotValidError.Type;

export const EmptyItemsError = Schema.Struct({
  _tag: Schema.Literal("empty-items"),
  message: Schema.String,
});
export type EmptyItemsError = typeof EmptyItemsError.Type;

export const EmptyEmailError = Schema.Struct({
  _tag: Schema.Literal("empty-email"),
  message: Schema.String,
});
export type EmptyEmailError = typeof EmptyEmailError.Type;

export const BillingAddressNotSetError = Schema.Struct({
  _tag: Schema.Literal("billing-address-not-set"),
  message: Schema.String,
});
export type BillingAddressNotSetError = typeof BillingAddressNotSetError.Type;

export const OrderCreateError = Schema.Struct({
  _tag: Schema.Literal("order-create"),
  message: Schema.String,
});
export type OrderCreateError = typeof OrderCreateError.Type;

export const AddItemError = Schema.Union([ProductNotFoundError, PricingNotFoundError]);
export type AddItemError = typeof AddItemError.Type;

export const RemoveItemError = ItemNotFoundError;
export type RemoveItemError = typeof RemoveItemError.Type;

export const UpdateItemQuantityError = ItemNotFoundError;
export type UpdateItemQuantityError = typeof UpdateItemQuantityError.Type;

export const UpdateAddressError = AddressNotValidError;
export type UpdateAddressError = typeof UpdateAddressError.Type;

export const UpdateEmailError = EmailNotValidError;
export type UpdateEmailError = typeof UpdateEmailError.Type;

export const CheckoutError = Schema.Union([
  ProductNotFoundError,
  PricingNotFoundError,
  EmptyItemsError,
  EmptyEmailError,
  BillingAddressNotSetError,
  OrderCreateError,
]);
export type CheckoutError = typeof CheckoutError.Type;

export const CartItem = Schema.Struct({
  productId: Schema.String,
  productName: Schema.String,
  productBrand: Schema.String,
  price: Schema.Number,
  quantity: Schema.Number,
});
export type CartItem = typeof CartItem.Type;

export const Cart = Schema.Struct({
  userId: Schema.String,
  items: Schema.Array(CartItem),
  email: Schema.optional(Schema.String),
  billingAddress: Schema.optional(Address),
  shippingAddress: Schema.optional(Address),
  total: Schema.Number,
  currency: Schema.String,
  previousOrderIds: Schema.Array(Schema.String),
  updatedAt: Datetime.Datetime,
});
export type Cart = typeof Cart.Type;

export const CartUpdated = Schema.Struct({
  userId: Schema.String,
});
export type CartUpdated = typeof CartUpdated.Type;

export const OrderConfirmation = Schema.Struct({
  userId: Schema.String,
  orderId: Schema.String,
});
export type OrderConfirmation = typeof OrderConfirmation.Type;

export const getCartItemsTotalPrice = (items: readonly CartItem[]): number =>
  items.reduce((total, item) => total + item.price * item.quantity, 0);
