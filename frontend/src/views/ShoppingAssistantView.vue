<script setup lang="ts">
import { ref, onMounted, nextTick, watch, computed } from "vue";
import { useAssistantStore } from "@/stores/assistantStore";
import { useAuthStore } from "@/stores/authStore";

const assistantStore = useAssistantStore();
const authStore = useAuthStore();

const inputMessage = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const chatContainer = ref<HTMLElement | null>(null);
const useStreaming = ref(true);

// Message history state
const showHistoryDropdown = ref(false);
const historyIndex = ref(-1);
const currentDraft = ref("");

// Extract unique user messages in reverse chronological order (most recent first)
const userMessageHistory = computed(() => {
  const list: string[] = [];
  for (let i = assistantStore.messages.length - 1; i >= 0; i--) {
    const msg = assistantStore.messages[i];
    if (msg?.role === "user" && msg.content && msg.content.trim()) {
      const text = msg.content.trim();
      if (!list.includes(text)) {
        list.push(text);
      }
    }
  }
  return list;
});

const reuseMessage = (content: string, autoSend = false) => {
  if (autoSend) {
    showHistoryDropdown.value = false;
    historyIndex.value = -1;
    currentDraft.value = "";
    handleSend(content);
  } else {
    inputMessage.value = content;
    showHistoryDropdown.value = false;
    historyIndex.value = -1;
    nextTick(() => {
      inputRef.value?.focus();
    });
  }
};

const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === "ArrowUp") {
    // Only intercept ArrowUp if history is available and input cursor is at beginning or already cycling
    const input = inputRef.value;
    const isAtStart = !input || input.selectionStart === 0;
    if (userMessageHistory.value.length > 0 && isAtStart) {
      if (historyIndex.value === -1) {
        currentDraft.value = inputMessage.value;
      }
      if (historyIndex.value < userMessageHistory.value.length - 1) {
        historyIndex.value++;
        inputMessage.value = userMessageHistory.value[historyIndex.value];
        e.preventDefault();
      }
    }
  } else if (e.key === "ArrowDown") {
    if (historyIndex.value > 0) {
      historyIndex.value--;
      inputMessage.value = userMessageHistory.value[historyIndex.value];
      e.preventDefault();
    } else if (historyIndex.value === 0) {
      historyIndex.value = -1;
      inputMessage.value = currentDraft.value;
      e.preventDefault();
    }
  } else if (e.key === "Escape") {
    if (showHistoryDropdown.value) {
      showHistoryDropdown.value = false;
    } else if (historyIndex.value !== -1) {
      inputMessage.value = currentDraft.value;
      historyIndex.value = -1;
    }
  }
};

const samplePrompts = [
  "Search for running shoes and show prices",
  "What items are currently in my cart?",
  "Recommend 3 trending items under $100",
  "Check out using my saved contact info",
  "Show me my recent order history",
  "Clear my cart",
];

const scrollToBottom = async () => {
  await nextTick();
  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
};

onMounted(async () => {
  if (authStore.userId) {
    await assistantStore.fetchHistory();
    await scrollToBottom();
  }
});

watch(
  () => assistantStore.messages.length,
  () => {
    scrollToBottom();
  },
);

watch(
  () => assistantStore.streamingText,
  () => {
    scrollToBottom();
  },
);

const handleSend = async (textToSend?: string) => {
  const message = (textToSend || inputMessage.value).trim();
  if (!message || assistantStore.isLoading) return;

  inputMessage.value = "";
  historyIndex.value = -1;
  currentDraft.value = "";
  showHistoryDropdown.value = false;
  await assistantStore.sendMessage(message, useStreaming.value);
  await scrollToBottom();
};

const handleClear = async () => {
  if (confirm("Are you sure you want to clear your conversation history?")) {
    await assistantStore.clearMessages();
  }
};

const getLastUserQuery = (): string => {
  for (let i = assistantStore.messages.length - 1; i >= 0; i--) {
    const msg = assistantStore.messages[i];
    if (msg?.role === "user" && msg.content?.trim()) {
      return msg.content.trim();
    }
  }
  return "";
};

const handleRetry = async () => {
  const query = getLastUserQuery();
  if (query) {
    await handleSend(query);
  }
};

const formatBannerError = (msg?: string): string => {
  return msg || "An error occurred with the AI assistant.";
};

const formatTime = (isoString: string) => {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

const formatToolName = (name: string) => {
  return name.replace(/_/g, " ");
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanMojibake(text: string): string {
  if (!text) return "";
  return text
    .replace(/â€“/g, "-")
    .replace(/â€”/g, " - ")
    .replace(/â€˜/g, "'")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€\x9d/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€¢/g, "•")
    .replace(/â€¦/g, "...")
    .replace(/Â /g, " ")
    .replace(/Â\$/g, "$");
}

function renderMarkdown(md: string): string {
  if (!md) return "";

  md = cleanMojibake(md);

  // 1. Extract code blocks
  const codeBlocks: string[] = [];
  let text = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre class="md-code-block"><code>${escapeHtml(code.trim())}</code></pre>`);
    return `\n\n${placeholder}\n\n`;
  });

  // 2. Extract inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(`<code class="md-inline-code">${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // 3. Escape HTML
  text = escapeHtml(text);

  // 4. Links: [text](url)
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="md-link" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // 5. Headings
  text = text.replace(/^### (.*$)/gim, '\n\n<h3 class="md-h3">$1</h3>\n\n');
  text = text.replace(/^## (.*$)/gim, '\n\n<h2 class="md-h2">$1</h2>\n\n');
  text = text.replace(/^# (.*$)/gim, '\n\n<h1 class="md-h1">$1</h1>\n\n');

  // 6. Bold & Italic
  text = text.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__(.*?)__/g, "<strong>$1</strong>");
  text = text.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  text = text.replace(/(?<!_)_(?!_)(.*?)(?<!_)_(?!_)/g, "<em>$1</em>");

  // 7. Unordered, Ordered Lists, and Blockquotes
  const lines = text.split("\n");
  const processed: string[] = [];
  let inUl = false;
  let inOl = false;
  let inBq = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ulMatch = line.match(/^(\s*)[*+-]\s+(.*)$/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    const bqMatch = line.match(/^>\s?(.*)$/);

    if (bqMatch) {
      if (inUl) {
        processed.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        processed.push("</ol>");
        inOl = false;
      }
      if (!inBq) {
        processed.push("");
        processed.push('<blockquote class="md-blockquote">');
        inBq = true;
      }
      processed.push(`  <p class="md-bq-p">${bqMatch[1]}</p>`);
    } else if (ulMatch) {
      if (inBq) {
        processed.push("</blockquote>");
        inBq = false;
      }
      if (!inUl) {
        if (inOl) {
          processed.push("</ol>");
          inOl = false;
        }
        processed.push("");
        processed.push('<ul class="md-ul">');
        inUl = true;
      }
      processed.push(`  <li class="md-li">${ulMatch[2]}</li>`);
    } else if (olMatch) {
      if (inBq) {
        processed.push("</blockquote>");
        inBq = false;
      }
      if (!inOl) {
        if (inUl) {
          processed.push("</ul>");
          inUl = false;
        }
        processed.push("");
        processed.push('<ol class="md-ol">');
        inOl = true;
      }
      processed.push(`  <li class="md-li">${olMatch[2]}</li>`);
    } else {
      if (inBq) {
        processed.push("</blockquote>");
        processed.push("");
        inBq = false;
      }
      if (inUl) {
        processed.push("</ul>");
        processed.push("");
        inUl = false;
      }
      if (inOl) {
        processed.push("</ol>");
        processed.push("");
        inOl = false;
      }
      processed.push(line);
    }
  }
  if (inBq) processed.push("</blockquote>");
  if (inUl) processed.push("</ul>");
  if (inOl) processed.push("</ol>");

  text = processed.join("\n");

  // 8. Paragraphs
  const blocks = text.split(/\n\s*\n/);
  text = blocks
    .map((block) => {
      block = block.trim();
      if (!block) return "";
      if (
        block.startsWith("<ul") ||
        block.startsWith("<ol") ||
        block.startsWith("<blockquote") ||
        block.startsWith("<h1") ||
        block.startsWith("<h2") ||
        block.startsWith("<h3") ||
        block.startsWith("<pre") ||
        block.startsWith("__CODE_BLOCK")
      ) {
        return block;
      }
      return `<p class="md-p">${block.replace(/\n/g, "<br/>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  // 9. Restore code blocks & inline code
  text = text.replace(/__INLINE_CODE_(\d+)__/g, (_, idx) => inlineCodes[Number(idx)]);
  text = text.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[Number(idx)]);

  return text;
}
</script>

<template>
  <div class="assistant-page">
    <!-- Header -->
    <div class="assistant-header glass-card">
      <div class="header-left">
        <div class="assistant-avatar">
          <span>🤖</span>
        </div>
        <div>
          <h1 class="gradient-text">AI Shopping Assistant</h1>
          <p class="subtitle">
            Autonomous multi-agent orchestration for search, pricing, cart, and checkout
          </p>
        </div>
      </div>
      <div class="header-actions">
        <button
          v-if="assistantStore.hasMessages"
          class="btn btn-secondary clear-btn"
          :disabled="assistantStore.isLoading"
          @click="handleClear"
        >
          🗑️ Clear History
        </button>
      </div>
    </div>

    <!-- Quick Prompts (if chat is empty) -->
    <div v-if="!assistantStore.hasMessages" class="starter-card glass-card">
      <h3>Ask anything or start with an autonomous task:</h3>
      <div class="quick-prompts">
        <button
          v-for="prompt in samplePrompts"
          :key="prompt"
          class="prompt-chip"
          @click="handleSend(prompt)"
        >
          ✨ {{ prompt }}
        </button>
      </div>
    </div>

    <!-- Chat Messages Window -->
    <div ref="chatContainer" class="chat-window glass">
      <div
        v-for="(msg, idx) in assistantStore.messages"
        :key="idx"
        :class="[
          'chat-bubble',
          msg.role === 'user' ? 'user-bubble' : 'assistant-bubble',
          msg.type === 'error' ? 'error-bubble' : '',
        ]"
      >
        <div class="bubble-header">
          <span class="bubble-role">
            <template v-if="msg.role === 'user'">You</template>
            <template v-else-if="msg.type === 'error'">⚠️ Error</template>
            <template v-else>🤖 Shopping Assistant</template>
          </span>
          <div class="bubble-header-right">
            <span v-if="msg.timestamp" class="bubble-time">
              {{ formatTime(msg.timestamp) }}
            </span>
            <button
              v-if="msg.role === 'user'"
              type="button"
              class="btn-icon-reuse"
              title="Reuse this message in input (or Shift+Click to send immediately)"
              @click.exact="reuseMessage(msg.content, false)"
              @click.shift.exact="reuseMessage(msg.content, true)"
            >
              ↺ Reuse
            </button>
            <button
              v-if="msg.type === 'error'"
              type="button"
              class="btn-icon-retry"
              :disabled="assistantStore.isLoading"
              title="Retry your last request"
              @click="handleRetry"
            >
              🔄 Retry
            </button>
          </div>
        </div>

        <!-- Tool Calls Display -->
        <div v-if="msg.toolCalls && msg.toolCalls.length > 0" class="tool-calls-container">
          <div v-for="tc in msg.toolCalls" :key="tc.id" class="tool-call-pill">
            <span class="tool-icon">⚡</span>
            <span class="tool-name">{{ formatToolName(tc.toolName) }}</span>
            <details v-if="tc.arguments || tc.result" class="tool-details">
              <summary>inspect</summary>
              <div v-if="tc.arguments" class="tool-payload">
                <strong>Args:</strong> <code>{{ tc.arguments }}</code>
              </div>
              <div v-if="tc.result" class="tool-payload">
                <strong>Result:</strong> <code>{{ tc.result }}</code>
              </div>
            </details>
          </div>
        </div>

        <!-- Message Body -->
        <div
          v-if="msg.role === 'assistant'"
          class="bubble-content markdown-body"
          v-html="renderMarkdown(msg.content)"
        ></div>
        <div v-else class="bubble-content">
          {{ msg.content }}
        </div>
      </div>

      <!-- Real-time Active Tools Indicator -->
      <div v-if="assistantStore.activeTools.length > 0" class="active-tools-indicator">
        <div
          v-for="tool in assistantStore.activeTools"
          :key="tool.id"
          :class="['active-tool-badge', tool.status]"
        >
          <span class="spinner" v-if="tool.status === 'running'"></span>
          <span v-else>✔</span>
          <span>{{ formatToolName(tool.name) }}</span>
          <span v-if="tool.summary" class="tool-summary">: {{ tool.summary }}</span>
        </div>
      </div>

      <!-- Real-time Streaming Message Delta -->
      <div
        v-if="assistantStore.isStreaming && assistantStore.streamingText"
        class="chat-bubble assistant-bubble streaming-bubble"
      >
        <div class="bubble-header">
          <span class="bubble-role">🤖 Shopping Assistant</span>
          <span class="streaming-pulse">generating...</span>
        </div>
        <div
          class="bubble-content markdown-body"
          v-html="
            renderMarkdown(assistantStore.streamingText) + '<span class=\'typing-cursor\'>▋</span>'
          "
        ></div>
      </div>

      <!-- Loading Indicator -->
      <div
        v-if="
          assistantStore.isLoading &&
          !assistantStore.streamingText &&
          assistantStore.activeTools.length === 0
        "
        class="chat-bubble assistant-bubble loading-bubble"
      >
        <div class="thinking-dots"><span></span><span></span><span></span></div>
      </div>
    </div>

    <!-- Error Alert Banner -->
    <div v-if="assistantStore.error" class="error-banner glass-card">
      <div class="error-banner-left">
        <span class="error-icon">⚠️</span>
        <span class="error-text">{{ formatBannerError(assistantStore.error.message) }}</span>
      </div>
      <div class="error-banner-actions">
        <button
          type="button"
          class="btn-banner-retry"
          :disabled="assistantStore.isLoading"
          title="Retry request"
          @click="handleRetry"
        >
          🔄 Retry
        </button>
        <button
          type="button"
          class="btn-close"
          title="Dismiss"
          @click="assistantStore.error = null"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- History & Input Area -->
    <div class="chat-input-area">
      <!-- Quick History Bar (shown if user has past messages) -->
      <div v-if="userMessageHistory.length > 0" class="history-bar">
        <div class="history-bar-left">
          <button
            type="button"
            class="history-toggle-btn"
            :class="{ active: showHistoryDropdown }"
            title="Browse full prompt history"
            @click="showHistoryDropdown = !showHistoryDropdown"
          >
            <span>🕒 History</span>
            <span class="badge-count">{{ userMessageHistory.length }}</span>
          </button>

          <div class="recent-chips-scroll">
            <span class="recent-label">Recent:</span>
            <button
              v-for="(historyItem, hIdx) in userMessageHistory.slice(0, 4)"
              :key="hIdx"
              type="button"
              class="recent-chip"
              :title="'Click to edit, Shift+Click to resend:\n' + historyItem"
              @click.exact="reuseMessage(historyItem, false)"
              @click.shift.exact="reuseMessage(historyItem, true)"
            >
              {{ historyItem.length > 28 ? historyItem.slice(0, 28) + "..." : historyItem }}
            </button>
          </div>
        </div>

        <div v-if="historyIndex !== -1" class="history-nav-indicator">
          <span>{{ historyIndex + 1 }} / {{ userMessageHistory.length }} (↑/↓ to cycle)</span>
        </div>
      </div>

      <!-- History Dropdown Popover -->
      <div
        v-if="showHistoryDropdown && userMessageHistory.length > 0"
        class="history-dropdown glass-card"
      >
        <div class="history-dropdown-header">
          <span>Past Messages ({{ userMessageHistory.length }})</span>
          <button type="button" class="btn-close" @click="showHistoryDropdown = false">✕</button>
        </div>
        <div class="history-dropdown-list">
          <div v-for="(item, i) in userMessageHistory" :key="i" class="history-item">
            <span class="history-text" :title="item" @click="reuseMessage(item, false)">
              {{ item }}
            </span>
            <div class="history-actions">
              <button
                type="button"
                class="btn-reuse-action"
                title="Edit message in input"
                @click="reuseMessage(item, false)"
              >
                ✏️ Edit
              </button>
              <button
                type="button"
                class="btn-resend-action"
                title="Send immediately"
                :disabled="assistantStore.isLoading"
                @click="reuseMessage(item, true)"
              >
                🚀 Resend
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Chat Input Form -->
      <form class="chat-input-bar glass-card" @submit.prevent="handleSend()">
        <input
          ref="inputRef"
          v-model="inputMessage"
          type="text"
          placeholder="Type a request (↑/↓ for history)..."
          :disabled="assistantStore.isLoading"
          class="chat-text-input"
          autofocus
          @keydown="handleKeyDown"
        />
        <div class="input-controls">
          <label class="stream-toggle">
            <input type="checkbox" v-model="useStreaming" />
            <span class="stream-label">Stream</span>
          </label>
          <button
            type="submit"
            class="btn btn-primary send-btn"
            :disabled="!inputMessage.trim() || assistantStore.isLoading"
          >
            <span v-if="assistantStore.isLoading" class="spinner"></span>
            <span v-else>Send →</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.assistant-page {
  max-width: 960px;
  margin: 1rem auto 2rem;
  padding: 0 1rem;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 150px);
}

.assistant-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding: 1.25rem 1.5rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.assistant-avatar {
  font-size: 1.8rem;
  width: 50px;
  height: 50px;
  background: rgba(139, 92, 246, 0.15);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 15px rgba(139, 92, 246, 0.2);
}

.assistant-header h1 {
  font-size: 1.4rem;
  font-weight: 700;
  margin: 0 0 0.2rem;
}

.subtitle {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 0;
}

.clear-btn {
  padding: 0.4rem 0.8rem;
  font-size: 0.8rem;
}

/* Starter Card */
.starter-card {
  padding: 1.25rem 1.5rem;
  margin-bottom: 1rem;
  text-align: center;
}

.starter-card h3 {
  font-size: 0.95rem;
  margin: 0 0 0.9rem;
  color: var(--text-muted);
  font-weight: 500;
}

.quick-prompts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: center;
}

.prompt-chip {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-color);
  border-radius: 9999px;
  padding: 0.45rem 0.9rem;
  font-size: 0.82rem;
  cursor: pointer;
  color: var(--text-main);
  transition: all 0.2s ease;
}

.prompt-chip:hover {
  background: rgba(139, 92, 246, 0.15);
  color: #c084fc;
  border-color: #c084fc;
  box-shadow: 0 0 10px rgba(139, 92, 246, 0.25);
}

/* Chat Window */
.chat-window {
  flex: 1;
  border-radius: 14px;
  padding: 1.5rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.chat-bubble {
  max-width: 82%;
  border-radius: 14px;
  padding: 1rem 1.25rem;
  line-height: 1.55;
  font-size: 0.92rem;
}

.user-bubble {
  align-self: flex-end;
  background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
  color: #ffffff;
  border-bottom-right-radius: 4px;
  box-shadow: 0 4px 14px rgba(139, 92, 246, 0.3);
}

.assistant-bubble {
  align-self: flex-start;
  background: rgba(17, 24, 39, 0.85);
  color: var(--text-main);
  border: 1px solid var(--border-color);
  border-bottom-left-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.bubble-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.75rem;
  margin-bottom: 0.4rem;
  opacity: 0.85;
}

.bubble-header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-icon-reuse {
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #ffffff;
  padding: 0.1rem 0.45rem;
  border-radius: 4px;
  font-size: 0.72rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-icon-reuse:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

.btn-icon-retry {
  background: rgba(245, 158, 11, 0.2);
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #fbbf24;
  padding: 0.12rem 0.5rem;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-icon-retry:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.35);
  color: #ffffff;
  transform: translateY(-1px);
}

.btn-icon-retry:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.assistant-bubble.error-bubble {
  background: rgba(28, 19, 14, 0.92);
  border: 1px solid rgba(245, 158, 11, 0.35);
  box-shadow: 0 4px 18px rgba(245, 158, 11, 0.12);
}

.assistant-bubble.error-bubble .bubble-role {
  color: #fbbf24;
}

.bubble-role {
  font-weight: 600;
}

.bubble-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.markdown-body {
  white-space: normal;
}

.markdown-body :deep(.md-p) {
  margin: 0 0 0.6rem 0;
  line-height: 1.6;
}

.markdown-body :deep(.md-p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(strong) {
  color: #ffffff;
  font-weight: 600;
}

.markdown-body :deep(em) {
  color: #cbd5e1;
  font-style: italic;
}

.markdown-body :deep(.md-ul),
.markdown-body :deep(.md-ol) {
  margin: 0.4rem 0 0.75rem 1.4rem;
  padding: 0;
}

.markdown-body :deep(.md-ul) {
  list-style-type: disc;
}

.markdown-body :deep(.md-ol) {
  list-style-type: decimal;
}

.markdown-body :deep(.md-li) {
  margin-bottom: 0.35rem;
  line-height: 1.55;
}

.markdown-body :deep(.md-h1) {
  font-size: 1.2rem;
  font-weight: 700;
  margin: 0.75rem 0 0.4rem;
  color: #ffffff;
}

.markdown-body :deep(.md-h2) {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0.65rem 0 0.35rem;
  color: #f1f5f9;
}

.markdown-body :deep(.md-h3) {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0.55rem 0 0.3rem;
  color: #e2e8f0;
}

.markdown-body :deep(.md-inline-code) {
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 0.15rem 0.35rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.85em;
  color: #38bdf8;
}

.markdown-body :deep(.md-code-block) {
  background: rgba(15, 23, 42, 0.9);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  margin: 0.6rem 0;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.82rem;
  color: #f8fafc;
}

.markdown-body :deep(.md-link) {
  color: #38bdf8;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-body :deep(.md-link:hover) {
  color: #7dd3fc;
}

.markdown-body :deep(.md-blockquote) {
  margin: 0.6rem 0 0.8rem 0;
  padding: 0.5rem 0.85rem;
  border-left: 3px solid #f59e0b;
  background: rgba(245, 158, 11, 0.08);
  border-radius: 0 6px 6px 0;
  font-size: 0.88rem;
  color: #fef3c7;
}

.markdown-body :deep(.md-bq-p) {
  margin: 0;
  line-height: 1.55;
}

/* Tool Calls */
.tool-calls-container {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.6rem;
}

.tool-call-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: rgba(139, 92, 246, 0.15);
  color: #c084fc;
  border: 1px solid rgba(139, 92, 246, 0.3);
  padding: 0.25rem 0.6rem;
  border-radius: 8px;
  font-size: 0.75rem;
  font-family: "JetBrains Mono", monospace;
  width: fit-content;
}

.tool-details summary {
  cursor: pointer;
  color: var(--accent-cyan);
  margin-left: 0.4rem;
  text-decoration: underline;
}

.tool-payload {
  margin-top: 0.4rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.tool-payload code {
  background: rgba(15, 23, 42, 0.8);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  color: var(--accent-cyan);
}

/* Active Tools Indicator */
.active-tools-indicator {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-self: flex-start;
}

.active-tool-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  padding: 0.4rem 0.8rem;
  border-radius: 9999px;
  font-family: "JetBrains Mono", monospace;
}

.active-tool-badge.running {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.active-tool-badge.completed {
  background: rgba(52, 211, 153, 0.15);
  color: #34d399;
  border: 1px solid rgba(52, 211, 153, 0.3);
}

.streaming-pulse {
  color: #34d399;
  font-style: italic;
}

.typing-cursor {
  animation: blink 1s step-end infinite;
  color: #c084fc;
  margin-left: 2px;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.thinking-dots {
  display: flex;
  gap: 5px;
  padding: 4px 6px;
}

.thinking-dots span {
  width: 7px;
  height: 7px;
  background: #c084fc;
  border-radius: 50%;
  animation: bounce 1.4s infinite ease-in-out both;
}

.thinking-dots span:nth-child(1) {
  animation-delay: -0.32s;
}
.thinking-dots span:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%,
  80%,
  100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}

.error-banner {
  background: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.3);
  padding: 0.65rem 1rem;
  border-radius: 10px;
  font-size: 0.85rem;
  margin-top: 0.75rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.error-banner-left {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex: 1;
}

.error-text {
  flex: 1;
}

.error-banner-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.btn-banner-retry {
  background: rgba(239, 68, 68, 0.25);
  border: 1px solid rgba(239, 68, 68, 0.5);
  color: #ffffff;
  padding: 0.2rem 0.6rem;
  border-radius: 5px;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-banner-retry:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.45);
}

.btn-banner-retry:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Chat Input Area & Message History */
.chat-input-area {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.75rem;
}

.history-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.25rem;
}

.history-bar-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  overflow: hidden;
}

.history-toggle-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-muted);
  border-radius: 6px;
  padding: 0.25rem 0.55rem;
  font-size: 0.75rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.history-toggle-btn:hover,
.history-toggle-btn.active {
  background: rgba(139, 92, 246, 0.2);
  color: #c084fc;
  border-color: #c084fc;
}

.badge-count {
  background: rgba(139, 92, 246, 0.3);
  color: #c084fc;
  font-weight: 600;
  font-size: 0.7rem;
  padding: 0.05rem 0.35rem;
  border-radius: 9999px;
}

.recent-chips-scroll {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: none;
}

.recent-chips-scroll::-webkit-scrollbar {
  display: none;
}

.recent-label {
  font-size: 0.72rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.recent-chip {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 9999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.74rem;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-chip:hover {
  background: rgba(139, 92, 246, 0.15);
  color: #c084fc;
  border-color: rgba(192, 132, 252, 0.4);
}

.history-nav-indicator {
  font-size: 0.72rem;
  color: #c084fc;
  background: rgba(139, 92, 246, 0.12);
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  white-space: nowrap;
}

/* History Dropdown Popover */
.history-dropdown {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 260px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.history-dropdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.8rem;
  border-bottom: 1px solid var(--border-color);
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
}

.btn-close {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
}

.btn-close:hover {
  color: var(--text-main);
  background: rgba(255, 255, 255, 0.1);
}

.history-dropdown-list {
  overflow-y: auto;
  padding: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  transition: background 0.15s ease;
}

.history-item:hover {
  background: rgba(139, 92, 246, 0.1);
}

.history-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.82rem;
  color: var(--text-main);
  cursor: pointer;
}

.history-text:hover {
  color: #c084fc;
}

.history-actions {
  display: flex;
  gap: 0.3rem;
  flex-shrink: 0;
}

.btn-reuse-action {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  border-radius: 4px;
  font-size: 0.72rem;
  padding: 0.15rem 0.45rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-reuse-action:hover {
  background: rgba(255, 255, 255, 0.2);
}

.btn-resend-action {
  background: rgba(139, 92, 246, 0.2);
  border: 1px solid rgba(139, 92, 246, 0.4);
  color: #c084fc;
  border-radius: 4px;
  font-size: 0.72rem;
  padding: 0.15rem 0.45rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-resend-action:hover:not(:disabled) {
  background: rgba(139, 92, 246, 0.35);
  color: #ffffff;
}

.btn-resend-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Chat Input Bar */
.chat-input-bar {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  align-items: center;
}

.chat-text-input {
  flex: 1;
  background: rgba(15, 23, 42, 0.6);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  font-size: 0.95rem;
  color: var(--text-main);
  outline: none;
  transition: all 0.2s;
}

.chat-text-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.2);
}

.input-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.stream-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}

.send-btn {
  padding: 0.75rem 1.4rem;
  font-size: 0.9rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
</style>
