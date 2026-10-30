import { Schema } from "effect";
import { Datetime } from "@golemcloud/effect-golem";

export const Product = Schema.Struct({
  productId: Schema.String,
  name: Schema.String,
  brand: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  createdAt: Datetime.Datetime,
  updatedAt: Datetime.Datetime,
});

export type Product = typeof Product.Type;
