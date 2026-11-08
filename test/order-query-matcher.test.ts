import { describe, it } from "node:test";
import assert from "node:assert";
import { DateTime, Effect } from "effect";
import { OrderQueryMatcher } from "../src/agents/order-search/order-query-matcher.js";
import { Order } from "../src/agents/order/order-schema.js";

describe("OrderQueryMatcher", () => {
  const now = Effect.runSync(DateTime.now);

  const sampleOrder: Order = {
    orderId: "ord-1001",
    userId: "cust-42",
    orderStatus: "new",
    items: [
      {
        productId: "ap001",
        productName: "AirPods Pro",
        productBrand: "Apple",
        price: 249,
        quantity: 1,
      },
      {
        productId: "sm002",
        productName: "Galaxy Buds",
        productBrand: "Samsung",
        price: 149,
        quantity: 2,
      },
    ],
    email: "customer@example.com",
    shippingAddress: {
      street: "123 Market St",
      city: "San Francisco",
      stateOrRegion: "CA",
      country: "USA",
      postalCode: "94103",
      name: "Alice Johnson",
      phoneNumber: null,
      email: null,
    },
    billingAddress: {
      street: "123 Market St",
      city: "San Francisco",
      stateOrRegion: "CA",
      country: "USA",
      postalCode: "94103",
      name: "Alice Johnson",
      phoneNumber: null,
      email: null,
    },
    total: 547,
    currency: "USD",
    createdAt: now,
    updatedAt: now,
  };

  it("matches by wildcard *", () => {
    const matcher = new OrderQueryMatcher("*");
    assert.strictEqual(matcher.matches(sampleOrder), true);
  });

  it("matches by status field filter", () => {
    const matcher1 = new OrderQueryMatcher("status:new");
    assert.strictEqual(matcher1.matches(sampleOrder), true);

    const matcher2 = new OrderQueryMatcher("status:shipped");
    assert.strictEqual(matcher2.matches(sampleOrder), false);
  });

  it("matches by userId field filter", () => {
    const matcher1 = new OrderQueryMatcher("userid:cust-42");
    assert.strictEqual(matcher1.matches(sampleOrder), true);

    const matcher2 = new OrderQueryMatcher("userid:cust-99");
    assert.strictEqual(matcher2.matches(sampleOrder), false);
  });

  it("matches by orderId field filter", () => {
    const matcher1 = new OrderQueryMatcher("id:ord-1001");
    assert.strictEqual(matcher1.matches(sampleOrder), true);

    const matcher2 = new OrderQueryMatcher("orderid:ord-9999");
    assert.strictEqual(matcher2.matches(sampleOrder), false);
  });

  it("matches by free text keyword in product name or brand", () => {
    const matcher1 = new OrderQueryMatcher("AirPods");
    assert.strictEqual(matcher1.matches(sampleOrder), true);

    const matcher2 = new OrderQueryMatcher("Samsung");
    assert.strictEqual(matcher2.matches(sampleOrder), true);

    const matcher3 = new OrderQueryMatcher("Sony");
    assert.strictEqual(matcher3.matches(sampleOrder), false);
  });

  it("matches by customer email or recipient name", () => {
    const matcher1 = new OrderQueryMatcher("customer@example.com");
    assert.strictEqual(matcher1.matches(sampleOrder), true);

    const matcher2 = new OrderQueryMatcher("Alice");
    assert.strictEqual(matcher2.matches(sampleOrder), true);
  });

  it("combines field filters and terms", () => {
    const matcher = new OrderQueryMatcher('status:new "AirPods"');
    assert.strictEqual(matcher.matches(sampleOrder), true);

    const mismatch = new OrderQueryMatcher('status:shipped "AirPods"');
    assert.strictEqual(mismatch.matches(sampleOrder), false);
  });
});
