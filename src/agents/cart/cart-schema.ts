import { Schema } from "effect";
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

export const InsufficientStockError = Schema.Struct({
  _tag: Schema.Literal("insufficient-stock"),
  message: Schema.String,
  productId: Schema.String,
  region: Schema.String,
  requested: Schema.Number,
  available: Schema.Number,
});
export type InsufficientStockError = typeof InsufficientStockError.Type;

export const ActionNotAllowedError = Schema.Struct({
  _tag: Schema.Literal("action-not-allowed"),
  message: Schema.String,
});
export type ActionNotAllowedError = typeof ActionNotAllowedError.Type;

export const AddItemError = Schema.Union([
  ProductNotFoundError,
  PricingNotFoundError,
  InsufficientStockError,
  ActionNotAllowedError,
]);
export type AddItemError = typeof AddItemError.Type;

export const RemoveItemError = Schema.Union([ItemNotFoundError, ActionNotAllowedError]);
export type RemoveItemError = typeof RemoveItemError.Type;

export const UpdateItemQuantityError = Schema.Union([
  ItemNotFoundError,
  InsufficientStockError,
  ActionNotAllowedError,
]);
export type UpdateItemQuantityError = typeof UpdateItemQuantityError.Type;

export const UpdateAddressError = Schema.Union([AddressNotValidError, ActionNotAllowedError]);
export type UpdateAddressError = typeof UpdateAddressError.Type;

export const UpdateEmailError = Schema.Union([EmailNotValidError, ActionNotAllowedError]);
export type UpdateEmailError = typeof UpdateEmailError.Type;

export const PrepareCheckoutError = Schema.Union([
  EmptyItemsError,
  EmptyEmailError,
  BillingAddressNotSetError,
  InsufficientStockError,
  ActionNotAllowedError,
]);
export type PrepareCheckoutError = typeof PrepareCheckoutError.Type;

export const NoActiveDraftError = Schema.Struct({
  _tag: Schema.Literal("no-active-draft"),
  message: Schema.String,
});
export type NoActiveDraftError = typeof NoActiveDraftError.Type;

export const OrderMismatchError = Schema.Struct({
  _tag: Schema.Literal("order-mismatch"),
  message: Schema.String,
});
export type OrderMismatchError = typeof OrderMismatchError.Type;

export const ReservationExpiredError = Schema.Struct({
  _tag: Schema.Literal("reservation-expired"),
  message: Schema.String,
});
export type ReservationExpiredError = typeof ReservationExpiredError.Type;

export const ConfirmCheckoutError = Schema.Union([
  NoActiveDraftError,
  OrderMismatchError,
  ReservationExpiredError,
  OrderCreateError,
  InsufficientStockError,
]);
export type ConfirmCheckoutError = typeof ConfirmCheckoutError.Type;

export const CheckoutDraft = Schema.Struct({
  orderId: Schema.String,
  expiresAt: Schema.DateTimeUtcFromString,
  createdAt: Schema.DateTimeUtcFromString,
});
export type CheckoutDraft = typeof CheckoutDraft.Type;

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
  updatedAt: Schema.DateTimeUtcFromString,
  draft: Schema.optional(CheckoutDraft),
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

export const SavedContactInfo = Schema.Struct({
  shippingAddress: Schema.NullOr(Address),
  billingAddress: Schema.NullOr(Address),
  email: Schema.NullOr(Schema.String),
  sourceOrderId: Schema.NullOr(Schema.String),
});
export type SavedContactInfo = typeof SavedContactInfo.Type;

export const getCartItemsTotalPrice = (items: readonly CartItem[]): number =>
  items.reduce((total, item) => total + item.price * item.quantity, 0);
