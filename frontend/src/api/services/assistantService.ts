import apiClient from "../config";
import { getProductsByIds, type Product } from "./productService.ts";
import type { PriceFilterOptions } from "@/api/services/pricingService.ts";

export interface RecommendedItems {
  productIds: string[];
  productBrands: string[];
}

export interface ToolCallRecord {
  id: string;
  toolName: string;
  arguments: string;
  result: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCallRecord[];
  timestamp: string;
  type?: "ok" | "error";
}

export interface ChatChunk {
  type: "tool_start" | "tool_result" | "text_delta" | "done" | "error";
  content: string;
  toolCall: ToolCallRecord;
}

export interface ChatResponse {
  reply: string;
  toolCallsUsed: ToolCallRecord[];
  type?: "ok" | "error";
}

export const getRecommendedProducts = async (
  userId: string,
  options?: PriceFilterOptions,
): Promise<Product[]> => {
  try {
    const recommendedItems: RecommendedItems = await apiClient.get(
      `/v1/assistant/${userId}/recommended-items`,
    );
    return await getProductsByIds(recommendedItems.productIds, options);
  } catch (error) {
    console.error("Failed to fetch recommended products:", error);
    throw error;
  }
};

export const chatWithAssistant = async (userId: string, message: string): Promise<ChatResponse> => {
  try {
    const response: ChatResponse = await apiClient.post(`/v1/assistant/${userId}/chat`, {
      message,
    });
    return response;
  } catch (error) {
    console.error("Failed to send chat message:", error);
    throw error;
  }
};

export const getAssistantHistory = async (userId: string): Promise<ChatMessage[]> => {
  try {
    const history: ChatMessage[] = await apiClient.get(`/v1/assistant/${userId}/history`);
    return history;
  } catch (error) {
    console.error("Failed to fetch assistant history:", error);
    throw error;
  }
};

export const clearAssistantHistory = async (userId: string): Promise<void> => {
  try {
    await apiClient.post(`/v1/assistant/${userId}/clear-history`, {});
  } catch (error) {
    console.error("Failed to clear assistant history:", error);
    throw error;
  }
};

export const streamChatWithAssistant = async (
  userId: string,
  message: string,
  onChunk: (chunk: ChatChunk) => void,
  signal?: AbortSignal,
): Promise<void> => {
  if (signal?.aborted) return;

  // 1. PUT to create or ensure the invocation session
  const putResponse = await fetch(`/api/v1/assistant/${userId}/chat-stream`, {
    method: "PUT",
    signal,
    headers: {
      "Content-Type": "application/json",
      "Stream-TTL": "300",
    },
    body: JSON.stringify({ message }),
  });

  if (!putResponse.ok) {
    throw new Error(
      `Failed to create stream session: ${putResponse.status} ${putResponse.statusText}`,
    );
  }

  const location = putResponse.headers.get("Location");
  if (!location) {
    throw new Error("Missing Location header from stream session creation");
  }

  // Resolve session path ensuring Vite /api proxy prefix
  let sessionPath = location;
  try {
    if (sessionPath.startsWith("http://") || sessionPath.startsWith("https://")) {
      sessionPath = new URL(sessionPath).pathname;
    }
  } catch {}
  if (!sessionPath.startsWith("/api")) {
    sessionPath = `/api${sessionPath.startsWith("/") ? "" : "/"}${sessionPath}`;
  }

  const slotName = "$result";
  const slotUrl = `${sessionPath}/streams/${encodeURIComponent(slotName)}?live=sse&offset=-1`;

  // 2. Open EventSource on the slot
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      fetch(sessionPath, { method: "DELETE" }).catch(() => {});
      resolve();
      return;
    }

    const eventSource = new EventSource(slotUrl);
    let isClosed = false;

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      eventSource.close();
      // Clean up session on agent
      fetch(sessionPath, { method: "DELETE" }).catch(() => {});
    };

    signal?.addEventListener("abort", () => {
      cleanup();
      resolve();
    });

    const handleData = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data)) {
          for (const item of data) {
            onChunk(item);
            if (item.type === "done") {
              cleanup();
              resolve();
              return;
            }
          }
        } else if (data && typeof data === "object") {
          onChunk(data);
          if (data.type === "done") {
            cleanup();
            resolve();
            return;
          }
        }
      } catch (err) {
        console.warn("Failed to parse SSE update:", err);
      }
    };

    eventSource.addEventListener("data", handleData as EventListener);
    eventSource.addEventListener("message", handleData as EventListener);
    eventSource.onmessage = handleData;

    eventSource.addEventListener("control", (event: any) => {
      try {
        const control = JSON.parse(event.data);
        if (control?.streamClosed) {
          cleanup();
          resolve();
        }
      } catch {}
    });

    eventSource.onerror = (err) => {
      if (eventSource.readyState === EventSource.CLOSED || !isClosed) {
        cleanup();
        reject(err);
      }
    };
  });
};
