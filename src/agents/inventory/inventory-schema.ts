import { DateTime, Schema } from "effect";

export const InventoryItem = Schema.Struct({
  region: Schema.String,
  totalQuantity: Schema.Number,
});
export type InventoryItem = typeof InventoryItem.Type;

export const OrderAllocation = Schema.Struct({
  orderId: Schema.String,
  region: Schema.String,
  quantity: Schema.Number,
  updatedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.optional(Schema.DateTimeUtcFromString),
});
export type OrderAllocation = typeof OrderAllocation.Type;

export const Inventory = Schema.Struct({
  productId: Schema.String,
  items: Schema.Array(InventoryItem),
  allocations: Schema.Array(OrderAllocation),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type Inventory = typeof Inventory.Type;

export const Availability = Schema.Struct({
  productId: Schema.String,
  region: Schema.String,
  availableQuantity: Schema.Number,
  totalQuantity: Schema.Number,
  allocatedQuantity: Schema.Number,
});
export type Availability = typeof Availability.Type;

export const InsufficientInventoryError = Schema.Struct({
  _tag: Schema.Literal("insufficient-inventory"),
  message: Schema.String,
  productId: Schema.String,
  region: Schema.String,
  requested: Schema.Number,
  available: Schema.Number,
});
export type InsufficientInventoryError = typeof InsufficientInventoryError.Type;

export const InventoryNotFoundError = Schema.Struct({
  _tag: Schema.Literal("inventory-not-found"),
  message: Schema.String,
  productId: Schema.String,
});
export type InventoryNotFoundError = typeof InventoryNotFoundError.Type;

export const ReserveQuantityError = Schema.Union([
  InsufficientInventoryError,
  InventoryNotFoundError,
]);
export type ReserveQuantityError = typeof ReserveQuantityError.Type;

export const mergeInventoryItems = (
  first: readonly InventoryItem[],
  second: readonly InventoryItem[],
): InventoryItem[] => {
  const map = new Map<string, InventoryItem>();
  for (const item of first) {
    map.set(item.region, item);
  }
  for (const item of second) {
    map.set(item.region, item);
  }
  return Array.from(map.values());
};

export const isAllocationExpired = (allocation: OrderAllocation, now: DateTime.Utc): boolean => {
  if (!allocation.expiresAt) return false;
  return DateTime.toEpochMillis(allocation.expiresAt) <= DateTime.toEpochMillis(now);
};

export const purgeExpiredAllocations = (
  allocations: readonly OrderAllocation[],
  now: DateTime.Utc,
): OrderAllocation[] => allocations.filter((a) => !isAllocationExpired(a, now));
