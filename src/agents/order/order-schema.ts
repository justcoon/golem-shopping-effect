import { Schema } from "effect";
import { Address } from "../../common/index.js";
import { InsufficientInventoryError } from "../inventory/inventory-schema.js";

export const OrderStatus = Schema.Union([
  Schema.Literal("new"),
  Schema.Literal("cancelled"),
  Schema.Literal("shipped"),
]);

export type OrderStatus = typeof OrderStatus.Type;

export const ActionNotAllowedError = Schema.Struct({
  _tag: Schema.Literal("action-not-allowed"),
  message: Schema.String,
  status: OrderStatus,
});
export type ActionNotAllowedError = typeof ActionNotAllowedError.Type;

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

export const InitOrderError = Schema.Union([ActionNotAllowedError, InsufficientInventoryError]);
export type InitOrderError = typeof InitOrderError.Type;

export const CancelOrderError = ActionNotAllowedError;
export type CancelOrderError = typeof CancelOrderError.Type;

export const ShipOrderError = ActionNotAllowedError;
export type ShipOrderError = typeof ShipOrderError.Type;

export const AddItemError = Schema.Union([
  ProductNotFoundError,
  PricingNotFoundError,
  ActionNotAllowedError,
  InsufficientInventoryError,
]);
export type AddItemError = typeof AddItemError.Type;

export const RemoveItemError = Schema.Union([ItemNotFoundError, ActionNotAllowedError]);
export type RemoveItemError = typeof RemoveItemError.Type;

export const UpdateItemQuantityError = Schema.Union([
  ItemNotFoundError,
  ActionNotAllowedError,
  InsufficientInventoryError,
]);
export type UpdateItemQuantityError = typeof UpdateItemQuantityError.Type;

export const UpdateAddressError = Schema.Union([AddressNotValidError, ActionNotAllowedError]);
export type UpdateAddressError = typeof UpdateAddressError.Type;

export const UpdateEmailError = Schema.Union([EmailNotValidError, ActionNotAllowedError]);
export type UpdateEmailError = typeof UpdateEmailError.Type;

export const OrderItem = Schema.Struct({
  productId: Schema.String,
  productName: Schema.String,
  productBrand: Schema.String,
  price: Schema.Number,
  quantity: Schema.Number,
});
export type OrderItem = typeof OrderItem.Type;

export const CreateOrder = Schema.Struct({
  userId: Schema.String,
  items: Schema.Array(OrderItem),
  email: Schema.optional(Schema.String),
  billingAddress: Schema.optional(Address),
  shippingAddress: Schema.optional(Address),
  total: Schema.Number,
  currency: Schema.String,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type CreateOrder = typeof CreateOrder.Type;

export const Order = Schema.Struct({
  orderId: Schema.String,
  userId: Schema.String,
  orderStatus: OrderStatus,
  items: Schema.Array(OrderItem),
  email: Schema.NullOr(Schema.String),
  billingAddress: Schema.NullOr(Address),
  shippingAddress: Schema.NullOr(Address),
  total: Schema.Number,
  currency: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type Order = typeof Order.Type;

export const OrderUpdated = Schema.Struct({
  userId: Schema.String,
  orderId: Schema.String,
});
export type OrderUpdated = typeof OrderUpdated.Type;

export const getOrderItemsTotalPrice = (items: readonly OrderItem[]): number =>
  items.reduce((total, item) => total + item.price * item.quantity, 0);
