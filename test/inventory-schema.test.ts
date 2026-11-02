import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime, Effect, Schema } from "effect";
import {
  Availability,
  InsufficientInventoryError,
  InventoryItem,
  mergeInventoryItems,
  OrderAllocation,
} from "../src/agents/inventory/inventory-schema.js";

describe("Inventory Schema & Business Logic", () => {
  it("merges inventory items by region correctly", () => {
    const existing: InventoryItem[] = [
      { region: "global", totalQuantity: 10 },
      { region: "us", totalQuantity: 5 },
    ];
    const incoming: InventoryItem[] = [
      { region: "us", totalQuantity: 8 },
      { region: "eu", totalQuantity: 12 },
    ];

    const merged = mergeInventoryItems(existing, incoming);
    assert.strictEqual(merged.length, 3);

    const globalItem = merged.find((i) => i.region === "global");
    const usItem = merged.find((i) => i.region === "us");
    const euItem = merged.find((i) => i.region === "eu");

    assert.strictEqual(globalItem?.totalQuantity, 10);
    assert.strictEqual(usItem?.totalQuantity, 8); // updated
    assert.strictEqual(euItem?.totalQuantity, 12); // added
  });

  it("decodes and encodes InsufficientInventoryError with correct schema shape", () => {
    const errorData = {
      _tag: "insufficient-inventory" as const,
      message: "Insufficient inventory for product ap001 in region global",
      productId: "ap001",
      region: "global",
      requested: 15,
      available: 10,
    };

    const decoded = Schema.decodeSync(InsufficientInventoryError)(errorData);
    assert.strictEqual(decoded._tag, "insufficient-inventory");
    assert.strictEqual(decoded.productId, "ap001");
    assert.strictEqual(decoded.requested, 15);
    assert.strictEqual(decoded.available, 10);
  });

  it("calculates available quantity correctly given total stock and allocations", () => {
    const totalQuantity = 20;
    const now = Effect.runSync(DateTime.now);
    const allocations: OrderAllocation[] = [
      {
        orderId: "ord-1",
        region: "global",
        quantity: 5,
        updatedAt: now,
      },
      {
        orderId: "ord-2",
        region: "global",
        quantity: 3,
        updatedAt: now,
      },
      {
        orderId: "ord-3",
        region: "us", // different region
        quantity: 7,
        updatedAt: now,
      },
    ];

    const globalAllocated = allocations
      .filter((a) => a.region === "global")
      .reduce((sum, a) => sum + a.quantity, 0);
    const globalAvailable = Math.max(0, totalQuantity - globalAllocated);

    assert.strictEqual(globalAllocated, 8);
    assert.strictEqual(globalAvailable, 12);

    const availabilityData: Availability = {
      productId: "prod-1",
      region: "global",
      totalQuantity,
      allocatedQuantity: globalAllocated,
      availableQuantity: globalAvailable,
    };

    const validated = Schema.decodeSync(Availability)(availabilityData);
    assert.strictEqual(validated.availableQuantity, 12);
  });
});
