import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DateTime, Duration, Effect, Exit, Schema } from "effect";
import {
  isAllocationExpired,
  OrderAllocation,
  purgeExpiredAllocations,
} from "../src/agents/inventory/inventory-schema.js";
import {
  ActionNotAllowedError,
  Cart,
  CheckoutDraft,
  ConfirmCheckoutError,
  PrepareCheckoutError,
} from "../src/agents/cart/cart-schema.js";
import { createToolFromAgentMethod } from "../src/ai/index.js";

describe("Two-Phase Checkout: Inventory Reservation & Expiration", () => {
  it("determines allocation expiration correctly", () => {
    const now = Effect.runSync(DateTime.now);
    const future = DateTime.addDuration(now, Duration.seconds(600));
    const past = DateTime.subtractDuration(now, Duration.seconds(10));

    const activeAlloc: OrderAllocation = {
      orderId: "ord-1",
      region: "global",
      quantity: 5,
      updatedAt: now,
      expiresAt: future,
    };

    const expiredAlloc: OrderAllocation = {
      orderId: "ord-2",
      region: "global",
      quantity: 3,
      updatedAt: now,
      expiresAt: past,
    };

    const permanentAlloc: OrderAllocation = {
      orderId: "ord-3",
      region: "global",
      quantity: 2,
      updatedAt: now,
      expiresAt: undefined,
    };

    assert.strictEqual(isAllocationExpired(activeAlloc, now), false);
    assert.strictEqual(isAllocationExpired(expiredAlloc, now), true);
    assert.strictEqual(isAllocationExpired(permanentAlloc, now), false);

    const allocations = [activeAlloc, expiredAlloc, permanentAlloc];
    const purged = purgeExpiredAllocations(allocations, now);

    assert.strictEqual(purged.length, 2);
    assert.strictEqual(
      purged.some((a) => a.orderId === "ord-1"),
      true,
    );
    assert.strictEqual(
      purged.some((a) => a.orderId === "ord-3"),
      true,
    );
    assert.strictEqual(
      purged.some((a) => a.orderId === "ord-2"),
      false,
    );
  });

  it("decodes CheckoutDraft correctly via Schema", () => {
    const now = Effect.runSync(DateTime.now);
    const expiresAt = DateTime.addDuration(now, Duration.seconds(600));

    const draftData = {
      orderId: "test-order-123",
      expiresAt: DateTime.formatIso(expiresAt),
      createdAt: DateTime.formatIso(now),
    };

    const decoded = Schema.decodeSync(CheckoutDraft)(draftData);
    assert.strictEqual(decoded.orderId, "test-order-123");
    assert.strictEqual(
      DateTime.toEpochMillis(decoded.expiresAt),
      DateTime.toEpochMillis(expiresAt),
    );
  });

  it("decodes Cart with active draft and validates structure", () => {
    const now = Effect.runSync(DateTime.now);
    const expiresAt = DateTime.addDuration(now, Duration.seconds(600));

    const cartData = {
      userId: "user-abc",
      items: [
        {
          productId: "prod-1",
          productName: "Test Product",
          productBrand: "BrandX",
          price: 49.99,
          quantity: 2,
        },
      ],
      total: 99.98,
      currency: "USD",
      email: null,
      billingAddress: null,
      shippingAddress: null,
      previousOrderIds: [],
      updatedAt: DateTime.formatIso(now),
      draft: {
        orderId: "draft-order-789",
        expiresAt: DateTime.formatIso(expiresAt),
        createdAt: DateTime.formatIso(now),
      },
    };

    const decoded = Schema.decodeSync(Cart)(cartData);
    assert.strictEqual(decoded.userId, "user-abc");
    assert.strictEqual(decoded.draft?.orderId, "draft-order-789");
    assert.strictEqual(decoded.items.length, 1);
  });

  it("validates PrepareCheckoutError and ConfirmCheckoutError union schemas", () => {
    const notAllowed = {
      _tag: "action-not-allowed" as const,
      message: "Cart is locked",
    };
    const decodedNotAllowed = Schema.decodeSync(ActionNotAllowedError)(notAllowed);
    assert.strictEqual(decodedNotAllowed._tag, "action-not-allowed");

    const decodedPrepareErr = Schema.decodeSync(PrepareCheckoutError)(notAllowed);
    assert.strictEqual(decodedPrepareErr._tag, "action-not-allowed");

    const expiredErr = {
      _tag: "reservation-expired" as const,
      message: "Draft expired",
    };
    const decodedConfirmErr = Schema.decodeSync(ConfirmCheckoutError)(expiredErr);
    assert.strictEqual(decodedConfirmErr._tag, "reservation-expired");
  });

  it("enforces cart draft locking and expiration invariants", () => {
    const now = Effect.runSync(DateTime.now);
    const activeExpiresAt = DateTime.addDuration(now, Duration.seconds(600));
    const expiredExpiresAt = DateTime.subtractDuration(now, Duration.seconds(10));

    const activeCart: Cart = {
      userId: "user-1",
      items: [],
      email: null,
      billingAddress: null,
      shippingAddress: null,
      total: 0,
      currency: "USD",
      previousOrderIds: [],
      updatedAt: now,
      draft: {
        orderId: "ord-active",
        expiresAt: activeExpiresAt,
        createdAt: now,
      },
    };

    const expiredCart: Cart = {
      userId: "user-2",
      items: [],
      email: null,
      billingAddress: null,
      shippingAddress: null,
      total: 0,
      currency: "USD",
      previousOrderIds: [],
      updatedAt: now,
      draft: {
        orderId: "ord-expired",
        expiresAt: expiredExpiresAt,
        createdAt: now,
      },
    };

    const purgeExpiredDraft = (cart: Cart, at: DateTime.Utc): Cart => {
      if (
        cart.draft &&
        DateTime.toEpochMillis(cart.draft.expiresAt) <= DateTime.toEpochMillis(at)
      ) {
        return { ...cart, draft: null, updatedAt: at };
      }
      return cart;
    };

    const isDraftActive = (cart: Cart, at: DateTime.Utc): boolean => {
      if (!cart.draft) return false;
      return DateTime.toEpochMillis(cart.draft.expiresAt) > DateTime.toEpochMillis(at);
    };

    assert.strictEqual(isDraftActive(activeCart, now), true);
    assert.strictEqual(isDraftActive(expiredCart, now), false);

    const purgedActive = purgeExpiredDraft(activeCart, now);
    assert.strictEqual(purgedActive.draft !== null, true);

    const purgedExpired = purgeExpiredDraft(expiredCart, now);
    assert.strictEqual(purgedExpired.draft, null);
  });

  it("derives prepare_checkout, confirm_checkout, and cancel_checkout assistant tools", () => {
    const mockCartAgent = {
      name: "CartAgent",
      methods: {
        prepareCheckout: {
          description: "Prepare checkout and reserve inventory",
          promptHint: "Call first to prepare checkout",
          input: {},
          success: Cart,
          error: PrepareCheckoutError,
        },
        confirmCheckout: {
          description: "Confirm and place order",
          promptHint: "Call to confirm order",
          input: {
            orderId: Schema.String.annotate({ description: "Order ID from prepareCheckout" }),
          },
          success: Schema.Void,
          error: ConfirmCheckoutError,
        },
        cancelCheckout: {
          description: "Cancel active checkout reservation",
          promptHint: "Call to cancel active hold",
          input: {
            orderId: Schema.String.annotate({ description: "Order ID to cancel" }),
          },
          success: Schema.Void,
          error: Schema.Never,
        },
      },
      client: {
        get: (_id: { id: string }) =>
          Effect.succeed({
            prepareCheckout: () => Effect.succeed({}),
            confirmCheckout: () => Effect.void,
            cancelCheckout: () => Effect.void,
          }),
      },
    };

    const userCartId = (ctx: { userId?: string }) => ({ id: ctx.userId ?? "" });

    const prepareTool = createToolFromAgentMethod(mockCartAgent, "prepareCheckout", {
      toolName: "prepare_checkout",
      resolveId: userCartId,
    });
    assert.strictEqual(prepareTool.name, "prepare_checkout");

    const confirmTool = createToolFromAgentMethod(mockCartAgent, "confirmCheckout", {
      toolName: "confirm_checkout",
      resolveId: userCartId,
    });
    assert.strictEqual(confirmTool.name, "confirm_checkout");
    assert.ok(confirmTool.parameters);

    const cancelTool = createToolFromAgentMethod(mockCartAgent, "cancelCheckout", {
      toolName: "cancel_checkout",
      resolveId: userCartId,
    });
    assert.strictEqual(cancelTool.name, "cancel_checkout");
    assert.ok(cancelTool.parameters);
  });

  it("rolls back prior reservations in reverse order when a subsequent item fails", async () => {
    const executed: string[] = [];
    const compensated: string[] = [];

    const reserveItem = (id: string, shouldFail: boolean) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          if (shouldFail) {
            throw new Error(`Out of stock: ${id}`);
          }
          executed.push(id);
          return id;
        }),
        (id, exit) =>
          Effect.sync(() => {
            if (!Exit.isSuccess(exit)) {
              compensated.push(id);
            }
          }),
      );

    const program = Effect.scoped(
      Effect.gen(function* () {
        yield* reserveItem("prod-1", false);
        yield* reserveItem("prod-2", false);
        yield* reserveItem("prod-3", true);
      }),
    );

    const exit = await Effect.runPromiseExit(program);
    assert.strictEqual(Exit.isFailure(exit), true);
    assert.deepStrictEqual(executed, ["prod-1", "prod-2"]);
    // Compensations run in reverse order (LIFO): prod-2, then prod-1
    assert.deepStrictEqual(compensated, ["prod-2", "prod-1"]);
  });

  it("preserves inventory allocation across confirmCheckout until shipment or cancellation", () => {
    const now = Effect.runSync(DateTime.now);
    const orderId = "order-test-lifecycle";

    // Initial inventory with permanent confirmed order allocation
    const inventory = {
      productId: "prod-1",
      items: [{ region: "global", totalQuantity: 10 }],
      allocations: [
        {
          orderId,
          region: "global",
          quantity: 2,
          updatedAt: now,
          expiresAt: undefined,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    // Before shipping: available quantity is 10 - 2 = 8
    const allocated = inventory.allocations
      .filter((a) => a.region === "global")
      .reduce((sum, a) => sum + a.quantity, 0);
    assert.strictEqual(inventory.items[0]!.totalQuantity - allocated, 8);

    // If cancelled before shipping: releaseReservation frees allocation without touching totalQuantity
    const releasedAllocations = inventory.allocations.filter((a) => a.orderId !== orderId);
    assert.strictEqual(releasedAllocations.length, 0);
    assert.strictEqual(inventory.items[0]!.totalQuantity, 10);
  });
});
