import { Schema } from "effect";

export const Product = Schema.Struct({
  productId: Schema.String,
  name: Schema.String,
  brand: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

export type Product = typeof Product.Type;
