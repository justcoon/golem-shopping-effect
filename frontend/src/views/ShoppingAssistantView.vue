<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from "vue";
import { useAssistantStore } from "@/stores/assistantStore";
import { useAuthStore } from "@/stores/authStore";

const assistantStore = useAssistantStore();
const authStore = useAuthStore();

const inputMessage = ref("");
const chatContainer = ref<HTMLElement | null>(null);
const useStreaming = ref(true);

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
  await assistantStore.sendMessage(message, useStreaming.value);
  await scrollToBottom();
};

const handleClear = async () => {
  if (confirm("Are you sure you want to clear your conversation history?")) {
    await assistantStore.clearMessages();
  }
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

function renderMarkdown(md: string): string {
  if (!md) return "";

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

  // 7. Unordered and Ordered Lists
  const lines = text.split("\n");
  const processed: string[] = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ulMatch = line.match(/^(\s*)[*+-]\s+(.*)$/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);

    if (ulMatch) {
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
        :class="['chat-bubble', msg.role === 'user' ? 'user-bubble' : 'assistant-bubble']"
      >
        <div class="bubble-header">
          <span class="bubble-role">
            {{ msg.role === "user" ? "You" : "🤖 Shopping Assistant" }}
          </span>
          <span v-if="msg.timestamp" class="bubble-time">
            {{ formatTime(msg.timestamp) }}
          </span>
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

    <!-- Error Alert -->
    <div v-if="assistantStore.error" class="error-banner glass-card">
      <span class="error-icon">⚠️</span>
      <span>{{ assistantStore.error.message || "An error occurred with the assistant." }}</span>
    </div>

    <!-- Chat Input Form -->
    <form class="chat-input-bar glass-card" @submit.prevent="handleSend()">
      <input
        v-model="inputMessage"
        type="text"
        placeholder="Type a request (e.g. 'Add running shoes to cart' or 'Checkout')..."
        :disabled="assistantStore.isLoading"
        class="chat-text-input"
        autofocus
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
  gap: 0.75rem;
  font-size: 0.75rem;
  margin-bottom: 0.4rem;
  opacity: 0.75;
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
  padding: 0.75rem 1rem;
  border-radius: 10px;
  font-size: 0.85rem;
  margin-top: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

/* Chat Input Bar */
.chat-input-bar {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.75rem;
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
