import { Effect, Layer, Schema } from "effect";
import { Tool } from "@golemcloud/effect-golem";
import { INVENTORY_REGION_DEFAULT } from "../common/index.js";
import { Availability, InventoryAgent } from "../agents/inventory/index.js";

export const inventoryToolHandlers = {
  checkInventory: (input: { "product-id": string; region?: string | null }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const productId = input["product-id"];
        const region = input.region ?? INVENTORY_REGION_DEFAULT;
        const client = yield* InventoryAgent.client.get({ id: productId }).pipe(Effect.orDie);
        const availability = yield* client.getAvailableQuantity({ region }).pipe(Effect.orDie);
        return availability;
      }),
    ),
};

export const inventoryToolDefinition = Tool.toolDefinition("inventory-tools", {
  doc: "Inventory management tools for checking stock and regional availability",
}).command("check-inventory", (cmd) =>
  cmd.body((b) =>
    b
      .option("product-id", Schema.String, {
        doc: "Product ID to check inventory for",
        required: true,
      })
      .option("region", Schema.String, {
        doc: `Optional fulfillment region (defaults to '${INVENTORY_REGION_DEFAULT}')`,
      })
      .returns(Availability, { doc: "Regional availability status and stock counts" }),
  ),
);

// Register provider implementation with Golem runtime
inventoryToolDefinition.implement(inventoryToolHandlers, Layer.empty);

export const inventoryTools = inventoryToolDefinition;
