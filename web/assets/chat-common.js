// @ts-check

/**
 * Shared chat formatting and utilities for Golem Web Clients.
 */

/**
 * Escapes HTML characters to prevent XSS.
 * @param {any} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Normalizes mojibake UTF-8 corruption from LLM responses.
 * @param {string} text
 * @returns {string}
 */
export function cleanMojibake(text) {
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

/**
 * Formats an ISO timestamp or date into HH:MM.
 * @param {string | undefined | null} [isoString]
 * @returns {string}
 */
export function formatTime(isoString) {
  try {
    const date = isoString ? new Date(isoString) : new Date();
    if (isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/**
 * Renders Markdown formatted text into sanitized HTML.
 * Supports headings, bold/italic, code blocks, inline code, links, blockquotes,
 * and deeply nested unordered/ordered lists.
 * @param {string} md
 * @returns {string}
 */
export function renderMarkdown(md) {
  if (!md) return "";

  md = cleanMojibake(md);

  // 1. Extract code blocks
  /** @type {string[]} */
  const codeBlocks = [];
  let text = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre class="md-code-block"><code>${escapeHtml(code.trim())}</code></pre>`);
    return `\n\n${placeholder}\n\n`;
  });

  // 2. Extract inline code
  /** @type {string[]} */
  const inlineCodes = [];
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

  // 7. Unordered, Ordered Lists, and Blockquotes (with nested indentation support)
  const lines = text.split("\n");
  /** @type {string[]} */
  const processed = [];
  let inBq = false;
  /** @type {Array<{ type: "ul" | "ol"; indent: number; hasOpenLi: boolean }>} */
  const listStack = [];

  function closeTopLi() {
    if (listStack.length > 0) {
      const top = listStack[listStack.length - 1];
      if (top.hasOpenLi) {
        if (processed.length > 0 && !processed[processed.length - 1].endsWith("</li>")) {
          processed[processed.length - 1] += "</li>";
        } else {
          processed.push("</li>");
        }
        top.hasOpenLi = false;
      }
    }
  }

  function closeList() {
    if (listStack.length > 0) {
      closeTopLi();
      const popped = listStack.pop();
      if (popped) {
        processed.push(`</${popped.type}>`);
      }
    }
  }

  function closeAllLists() {
    while (listStack.length > 0) {
      closeList();
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ulMatch = line.match(/^(\s*)[*+-]\s+(.*)$/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    const bqMatch = line.match(/^>\s?(.*)$/);

    if (bqMatch) {
      closeAllLists();
      if (!inBq) {
        processed.push("");
        processed.push('<blockquote class="md-blockquote">');
        inBq = true;
      }
      processed.push(`  <p class="md-bq-p">${bqMatch[1]}</p>`);
    } else if (ulMatch || olMatch) {
      if (inBq) {
        processed.push("</blockquote>");
        inBq = false;
      }
      const rawIndent = (ulMatch || olMatch)[1];
      const indent = rawIndent.replace(/\t/g, "  ").length;
      const type = ulMatch ? "ul" : "ol";
      const content = (ulMatch || olMatch)[2];

      if (listStack.length === 0) {
        processed.push("");
        processed.push(`<${type} class="md-${type}">`);
        processed.push(`  <li class="md-li">${content}`);
        listStack.push({ type, indent, hasOpenLi: true });
      } else {
        const top = listStack[listStack.length - 1];
        if (indent > top.indent) {
          processed.push(`<${type} class="md-${type}">`);
          processed.push(`  <li class="md-li">${content}`);
          listStack.push({ type, indent, hasOpenLi: true });
        } else {
          while (listStack.length > 0 && indent < listStack[listStack.length - 1].indent) {
            closeList();
          }
          if (listStack.length === 0) {
            processed.push(`<${type} class="md-${type}">`);
            processed.push(`  <li class="md-li">${content}`);
            listStack.push({ type, indent, hasOpenLi: true });
          } else {
            const currentTop = listStack[listStack.length - 1];
            if (currentTop.type !== type || indent > currentTop.indent) {
              if (currentTop.type !== type) {
                closeList();
              }
              processed.push(`<${type} class="md-${type}">`);
              processed.push(`  <li class="md-li">${content}`);
              listStack.push({ type, indent, hasOpenLi: true });
            } else {
              closeTopLi();
              processed.push(`  <li class="md-li">${content}`);
              currentTop.hasOpenLi = true;
            }
          }
        }
      }
    } else {
      if (inBq) {
        processed.push("</blockquote>");
        processed.push("");
        inBq = false;
      }
      if (listStack.length > 0) {
        closeAllLists();
        processed.push("");
      }
      processed.push(line);
    }
  }

  if (inBq) processed.push("</blockquote>");
  closeAllLists();

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

/**
 * Normalizes raw Golem SSE event data into typed chat stream events.
 * Handles array batches, WIT variant keying ({ tool_start: {...} }),
 * kebab-case keys ({ "tool-start": {...} }), and Effect TaggedStruct ({ _tag: "tool_start", ... }).
 *
 * @param {string} rawData
 * @returns {Array<{ tag: string, payload: any }>}
 */
export function parseStreamEvents(rawData) {
  if (!rawData) return [];
  try {
    const parsed = JSON.parse(rawData);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    /** @type {Array<{ tag: string, payload: any }>} */
    const events = [];

    for (const item of items) {
      if (!item || typeof item !== "object") continue;

      let tag = item._tag;
      let payload = item;

      if (!tag) {
        const keys = Object.keys(item);
        if (keys.length === 1) {
          const key = keys[0];
          tag = key.replace(/-/g, "_");
          payload = item[key] || {};
        }
      }

      if (tag) {
        events.push({ tag, payload });
      }
    }

    return events;
  } catch (err) {
    console.warn("Failed to parse stream event:", err);
    return [];
  }
}

/**
 * Creates a running tool card element with a spinner.
 * @param {{ id?: string, toolName?: string }} toolCall
 * @returns {HTMLDivElement}
 */
export function createRunningToolCard(toolCall) {
  const card = document.createElement("div");
  card.className = "tool-card running";
  card.innerHTML = `
    <span class="tool-spinner"></span>
    <span>Executing <strong>${escapeHtml(toolCall?.toolName || "tool")}</strong>...</span>
  `;
  return card;
}

/**
 * Updates a running tool card element to completed or failed state.
 * @param {HTMLElement} card
 * @param {{ toolName?: string, result?: any }} toolCall
 */
export function updateCompletedToolCard(card, toolCall) {
  let summary = "Completed";
  try {
    const resObj =
      typeof toolCall.result === "string" ? JSON.parse(toolCall.result) : toolCall.result;
    summary = resObj?.summary || (resObj?.error ? `Failed: ${resObj.error}` : "Done");
  } catch {
    summary = toolCall?.result ? String(toolCall.result) : "Done";
  }
  const isFailed = summary.toLowerCase().includes("failed");
  card.className = `tool-card ${isFailed ? "failed" : "completed"}`;
  card.innerHTML = `
    <span>${isFailed ? "⚠️" : "✅"}</span>
    <span><strong>${escapeHtml(toolCall?.toolName || "tool")}:</strong> ${escapeHtml(summary)}</span>
  `;
}

/**
 * Creates a static completed tool card (for historical messages or sync fallback).
 * @param {{ toolName?: string }} toolCall
 * @returns {HTMLDivElement}
 */
export function createCompletedToolCard(toolCall) {
  const card = document.createElement("div");
  card.className = "tool-card completed";
  card.innerHTML = `
    <span>✅</span>
    <span><strong>${escapeHtml(toolCall?.toolName || "tool")}</strong></span>
  `;
  return card;
}


