import { Tool } from "@golemcloud/effect-golem";
import { registerToolSdk } from "../ai/pi-tools.js";

// Register Golem Tool SDK to enable in-guest Tool.client & registeredTools resolution
registerToolSdk(Tool);

export * from "./catalog-tools.js";
export * from "./inventory-tools.js";
export * from "./cart-tools.js";
export * from "./customer-order-tools.js";
export * from "./manager-order-tools.js";
