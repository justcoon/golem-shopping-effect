import { describe, it } from "node:test";
import assert from "node:assert";
import { ProductQueryMatcher } from "../src/agents/product-search/product-query-matcher.js";
import { Product } from "../src/agents/product/product-schema.js";

const sampleProduct: Product = {
  productId: "prod-1",
  name: "iPhone 15 Pro",
  brand: "Apple",
  description: "Latest smartphone with titanium design",
  tags: ["mobile", "apple", "flagship"],
  createdAt: { seconds: 1700000000n, nanoseconds: 0 },
  updatedAt: { seconds: 1700000000n, nanoseconds: 0 },
};

describe("ProductQueryMatcher", () => {
  it("matches by wildcard *", () => {
    const matcher = new ProductQueryMatcher("*");
    assert.strictEqual(matcher.matches(sampleProduct), true);
  });

  it("matches by keyword term in name or description", () => {
    const matcher1 = new ProductQueryMatcher("titanium");
    assert.strictEqual(matcher1.matches(sampleProduct), true);

    const matcher2 = new ProductQueryMatcher("samsung");
    assert.strictEqual(matcher2.matches(sampleProduct), false);
  });

  it("matches by brand filter", () => {
    const matcher1 = new ProductQueryMatcher("brand:Apple");
    assert.strictEqual(matcher1.matches(sampleProduct), true);

    const matcher2 = new ProductQueryMatcher("brand:Google");
    assert.strictEqual(matcher2.matches(sampleProduct), false);
  });

  it("matches by tag filter", () => {
    const matcher1 = new ProductQueryMatcher("tag:flagship");
    assert.strictEqual(matcher1.matches(sampleProduct), true);

    const matcher2 = new ProductQueryMatcher("tag:budget");
    assert.strictEqual(matcher2.matches(sampleProduct), false);
  });

  it("matches multiple tokens and field filters combined", () => {
    const matcher1 = new ProductQueryMatcher("brand:Apple phone");
    assert.strictEqual(matcher1.matches(sampleProduct), true);

    const matcher2 = new ProductQueryMatcher("brand:Apple android");
    assert.strictEqual(matcher2.matches(sampleProduct), false);
  });

  it("handles quoted phrases", () => {
    const matcher = new ProductQueryMatcher('"iPhone 15"');
    assert.strictEqual(matcher.matches(sampleProduct), true);
  });
});

