import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  getRecommendedProducts,
  chatWithAssistant,
  streamChatWithAssistant,
  getAssistantHistory,
  clearAssistantHistory,
  type ChatMessage,
  type ToolCallRecord,
  type ChatChunk,
} from "@/api/services/assistantService";
import { useAuthStore } from "./authStore";
import { useCartStore } from "./cartStore";
import type { PriceFilterOptions } from "@/api/services/pricingService.ts";
import type { Product } from "@/api/services/productService.ts";

export interface ActiveToolStatus {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  summary?: string;
}

export const useAssistantStore = defineStore("assistant", () => {
  const recommendedProducts = ref<Product[]>([]);
  const messages = ref<ChatMessage[]>([]);
  const isLoading = ref(false);
  const isStreaming = ref(false);
  const activeTools = ref<ActiveToolStatus[]>([]);
  const streamingText = ref("");
  const error = ref<Error | null>(null);
  const lastUpdated = ref<Date | null>(null);

  const authStore = useAuthStore();
  const cartStore = useCartStore();

  const hasRecommendations = computed(() => recommendedProducts.value.length > 0);
  const hasMessages = computed(() => messages.value.length > 0);

  const fetchHistory = async () => {
    if (!authStore.userId) return;
    try {
      const history = await getAssistantHistory(authStore.userId);
      messages.value = history;
    } catch (err) {
      console.warn("Could not fetch assistant history:", err);
    }
  };

  const clearMessages = async () => {
    if (!authStore.userId) return;
    try {
      await clearAssistantHistory(authStore.userId);
      messages.value = [];
    } catch (err) {
      console.error("Failed to clear messages:", err);
    }
  };

  const cartMutatingTools = new Set([
    "add_to_cart",
    "update_cart_quantity",
    "remove_from_cart",
    "clear_cart",
    "apply_saved_contact_info",
    "set_shipping_address",
    "set_billing_address",
    "set_email",
    "checkout_cart",
  ]);

  const refreshCartIfCartToolsUsed = (toolNames: string[]) => {
    if (!authStore.userId) return;
    const touchedCart = toolNames.some((tool) => cartMutatingTools.has(tool));
    if (touchedCart) {
      cartStore.fetchCart(authStore.userId);
    }
  };

  const sendMessage = async (content: string, stream = true) => {
    if (!authStore.userId || !content.trim()) return;

    const userMessage: ChatMessage = {
      role: "user",
      content,
      timestamp: new Date().toISOString(),
      type: "ok",
    };
    messages.value.push(userMessage);

    isLoading.value = true;
    error.value = null;
    activeTools.value = [];
    streamingText.value = "";

    const usedToolNames: string[] = [];
    const accumulatedToolCalls: ToolCallRecord[] = [];
    let streamHadError = false;

    if (stream) {
      isStreaming.value = true;
      try {
        await streamChatWithAssistant(authStore.userId, content, (chunk: ChatChunk) => {
          const tc = chunk.toolCall;

          if (chunk.type === "tool_start" && tc?.toolName) {
            const finalId = tc.id || `${tc.toolName}-${Date.now()}`;
            usedToolNames.push(tc.toolName);
            activeTools.value.push({
              id: finalId,
              name: tc.toolName,
              status: "running",
              summary: chunk.content,
            });
            accumulatedToolCalls.push({
              id: finalId,
              toolName: tc.toolName,
              arguments: tc.arguments ?? "",
              result: "",
            });
          } else if (chunk.type === "tool_result" && tc?.toolName) {
            const finalId = tc.id;
            const tool = activeTools.value.find(
              (t) =>
                (finalId ? t.id === finalId : t.name === tc.toolName && t.status === "running"),
            );
            if (tool) {
              tool.status = "completed";
              tool.summary = chunk.content;
            }
            const existingTc = accumulatedToolCalls.find(
              (t) => (finalId ? t.id === finalId : t.toolName === tc.toolName && !t.result),
            );
            if (existingTc) {
              existingTc.result = tc.result || chunk.content;
              if (tc.arguments && !existingTc.arguments) {
                existingTc.arguments = tc.arguments;
              }
            } else {
              accumulatedToolCalls.push({
                id: finalId || `${tc.toolName}-${Date.now()}`,
                toolName: tc.toolName,
                arguments: tc.arguments ?? "",
                result: tc.result || chunk.content,
              });
            }
          } else if (chunk.type === "text_delta") {
            streamingText.value += chunk.content;
          } else if (chunk.type === "error") {
            streamHadError = true;
            error.value = new Error(chunk.content);
          }
        });

        if (streamingText.value.trim()) {
          const assistantMessage: ChatMessage = {
            role: "assistant",
            content: streamingText.value,
            toolCalls: accumulatedToolCalls.length > 0 ? [...accumulatedToolCalls] : undefined,
            timestamp: new Date().toISOString(),
            type: streamHadError ? "error" : "ok",
          };
          messages.value.push(assistantMessage);
        } else {
          // Fallback to fetchHistory if stream delivered directly to backend
          await fetchHistory();
        }

        refreshCartIfCartToolsUsed(usedToolNames);
      } catch (err) {
        console.warn("Stream failed, falling back to synchronous chat:", err);
        // Fallback to sync chat
        try {
          const res = await chatWithAssistant(authStore.userId, content);
          messages.value.push({
            role: "assistant",
            content: res.reply,
            toolCalls: res.toolCallsUsed,
            timestamp: new Date().toISOString(),
            type: res.type ?? "ok",
          });
          refreshCartIfCartToolsUsed(res.toolCallsUsed.map((tc: ToolCallRecord) => tc.toolName));
        } catch (syncErr) {
          error.value = syncErr as Error;
        }
      } finally {
        isStreaming.value = false;
        isLoading.value = false;
        streamingText.value = "";
      }
    } else {
      try {
        const res = await chatWithAssistant(authStore.userId, content);
        messages.value.push({
          role: "assistant",
          content: res.reply,
          toolCalls: res.toolCallsUsed,
          timestamp: new Date().toISOString(),
          type: res.type ?? "ok",
        });
        refreshCartIfCartToolsUsed(res.toolCallsUsed.map((tc: ToolCallRecord) => tc.toolName));
      } catch (err) {
        error.value = err as Error;
      } finally {
        isLoading.value = false;
      }
    }
  };

  const fetchRecommendedProducts = async (options?: PriceFilterOptions) => {
    if (authStore.userId) {
      isLoading.value = true;
      error.value = null;

      try {
        const results = await getRecommendedProducts(authStore.userId, options);
        recommendedProducts.value = results;
      } catch (err) {
        error.value = err as Error;
        console.error("Error getting recommended products:", err);
      } finally {
        isLoading.value = false;
      }
    } else {
      clearRecommendations();
    }
  };

  const clearRecommendations = () => {
    recommendedProducts.value = [];
    lastUpdated.value = null;
  };

  return {
    // State
    recommendedProducts,
    messages,
    isLoading,
    isStreaming,
    activeTools,
    streamingText,
    error,
    lastUpdated,

    // Getters
    hasRecommendations,
    hasMessages,

    // Actions
    fetchHistory,
    clearMessages,
    sendMessage,
    fetchRecommendedProducts,
    clearRecommendations,
  };
});
