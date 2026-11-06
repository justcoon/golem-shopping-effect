import test from "node:test";
import assert from "node:assert/strict";
import { Schema } from "effect";
import {
  cleanMarkdownJsonString,
  reduceOrderItems,
  RecommendedItems,
  RECOMMENDATION_INPUT_COUNT,
} from "../src/agents/shopping-recommendation/shopping-recommendation-schema.js";
import type { OrderItem } from "../src/agents/order/order-schema.js";

test("reduceOrderItems aggregates quantities and sorts by quantity descending", () => {
  const items: OrderItem[] = [
    {
      productId: "prod-1",
      productName: "Sneakers",
      productBrand: "Nike",
      quantity: 2,
      price: 100,
    },
    {
      productId: "prod-2",
      productName: "T-shirt",
      productBrand: "Adidas",
      quantity: 5,
      price: 20,
    },
    {
      productId: "prod-1",
      productName: "Sneakers",
      productBrand: "Nike",
      quantity: 3,
      price: 100,
    },
    {
      productId: "prod-3",
      productName: "Socks",
      productBrand: "Puma",
      quantity: 1,
      price: 10,
    },
  ];

  const reduced = reduceOrderItems(items);

  assert.equal(reduced.length, 3);
  // prod-1 has total 5 (2 + 3), prod-2 has 5, prod-3 has 1
  assert.equal(reduced[0]?.productId, "prod-1");
  assert.equal(reduced[0]?.quantity, 5);
  assert.equal(reduced[1]?.productId, "prod-2");
  assert.equal(reduced[1]?.quantity, 5);
  assert.equal(reduced[2]?.productId, "prod-3");
  assert.equal(reduced[2]?.quantity, 1);
});

test("reduceOrderItems respects RECOMMENDATION_INPUT_COUNT cap", () => {
  const items: OrderItem[] = Array.from({ length: 150 }, (_, i) => ({
    productId: `prod-${i}`,
    productName: `Product ${i}`,
    productBrand: `Brand ${i}`,
    quantity: i,
    price: 10,
  }));

  const reduced = reduceOrderItems(items);
  assert.equal(reduced.length, RECOMMENDATION_INPUT_COUNT);
  assert.equal(reduced[0]?.productId, "prod-149");
});

test("cleanMarkdownJsonString extracts JSON from codeblocks", () => {
  const wrapped = '```json\n{"productIds": ["p1"], "productBrands": ["Nike"]}\n```';
  assert.equal(
    cleanMarkdownJsonString(wrapped),
    '{"productIds": ["p1"], "productBrands": ["Nike"]}',
  );

  const plain = '{"productIds": ["p2"], "productBrands": ["Adidas"]}';
  assert.equal(cleanMarkdownJsonString(plain), plain);
});

test("RecommendedItems schema encodes and decodes properly", () => {
  const now = new Date().toISOString();
  const raw = {
    productIds: ["p1", "p2"],
    productBrands: ["BrandA", "BrandB"],
    createdAt: now,
    updatedAt: now,
  };

  const decoded = Schema.decodeUnknownSync(RecommendedItems)(raw);
  assert.deepEqual(decoded.productIds, ["p1", "p2"]);
  assert.deepEqual(decoded.productBrands, ["BrandA", "BrandB"]);

  const encoded = Schema.encodeSync(RecommendedItems)(decoded);
  assert.equal(encoded.productIds.length, 2);
});
