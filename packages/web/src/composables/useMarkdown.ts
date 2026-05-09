/**
 * Markdown rendering composable.
 * Uses `marked` + `highlight.js` + `DOMPurify` — the full-featured renderer
 * that was previously only in MessageItem.vue.
 * Replaces the weak regex-based MarkdownRenderer.vue.
 */

import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import katex from "katex";
import "katex/dist/katex.min.css";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";

const markdownParser = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, text, tokens }) {
      const title = tokens.map((t) => typeof t === "string" ? t : t.raw).join("");
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text || title}</a>`;
    },
  },
});

markdownParser.use(markedHighlight({
  emptyLangClass: "hljs",
  langPrefix: "hljs language-",
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, {
        language,
        ignoreIllegals: true,
      }).value;
    }
    return hljs.highlightAuto(code).value;
  },
}));

interface MathToken {
  id: number;
  expression: string;
  displayMode: boolean;
}

const INLINE_MATH_OPEN = "\\(";
const INLINE_MATH_CLOSE = "\\)";
const BLOCK_MATH_OPEN = "\\[";
const BLOCK_MATH_CLOSE = "\\]";

function isEscaped(input: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && input[i] === "\\"; i--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function readBacktickRun(input: string, index: number): string {
  let end = index;
  while (end < input.length && input[end] === "`") {
    end++;
  }
  return input.slice(index, end);
}

function findClosingDelimiter(input: string, startIndex: number, delimiter: string): number {
  let index = startIndex;
  while (index < input.length) {
    const found = input.indexOf(delimiter, index);
    if (found < 0) {
      return -1;
    }
    if (!isEscaped(input, found)) {
      return found;
    }
    index = found + delimiter.length;
  }
  return -1;
}

function shouldOpenDollarMath(input: string, index: number): boolean {
  if (isEscaped(input, index)) {
    return false;
  }
  const next = input[index + 1];
  return next !== undefined && !/\s/.test(next);
}

function shouldCloseDollarMath(input: string, index: number): boolean {
  if (isEscaped(input, index)) {
    return false;
  }
  const previous = input[index - 1];
  return previous !== undefined && !/\s/.test(previous);
}

function findClosingDollar(input: string, startIndex: number, delimiter: "$" | "$$"): number {
  let index = startIndex;
  while (index < input.length) {
    const found = input.indexOf(delimiter, index);
    if (found < 0) {
      return -1;
    }
    if (delimiter === "$$") {
      if (!isEscaped(input, found)) {
        return found;
      }
    } else if (
      input[found - 1] !== "$"
      && input[found + 1] !== "$"
      && shouldCloseDollarMath(input, found)
    ) {
      return found;
    }
    index = found + delimiter.length;
  }
  return -1;
}

function mathPlaceholder(id: number, displayMode: boolean): string {
  return displayMode
    ? `\n\n<div data-math-placeholder="${id}"></div>\n\n`
    : `<span data-math-placeholder="${id}"></span>`;
}

function extractMath(content: string): { markdown: string; tokens: MathToken[] } {
  const tokens: MathToken[] = [];
  let markdown = "";
  let index = 0;

  while (index < content.length) {
    if (content.startsWith("```", index) || content.startsWith("~~~", index)) {
      const fence = content.slice(index, index + 3);
      const closeIndex = content.indexOf(fence, index + 3);
      if (closeIndex < 0) {
        markdown += content.slice(index);
        break;
      }
      const endIndex = closeIndex + fence.length;
      markdown += content.slice(index, endIndex);
      index = endIndex;
      continue;
    }

    if (content[index] === "`") {
      const run = readBacktickRun(content, index);
      const closeIndex = content.indexOf(run, index + run.length);
      if (closeIndex < 0) {
        markdown += content[index];
        index++;
        continue;
      }
      const endIndex = closeIndex + run.length;
      markdown += content.slice(index, endIndex);
      index = endIndex;
      continue;
    }

    const tokenStart = tokens.length;
    if (content.startsWith("$$", index) && !isEscaped(content, index)) {
      const closeIndex = findClosingDollar(content, index + 2, "$$");
      if (closeIndex >= 0) {
        tokens.push({
          id: tokenStart,
          expression: content.slice(index + 2, closeIndex).trim(),
          displayMode: true,
        });
        markdown += mathPlaceholder(tokenStart, true);
        index = closeIndex + 2;
        continue;
      }
    }

    if (content.startsWith(BLOCK_MATH_OPEN, index) && !isEscaped(content, index)) {
      const closeIndex = findClosingDelimiter(content, index + BLOCK_MATH_OPEN.length, BLOCK_MATH_CLOSE);
      if (closeIndex >= 0) {
        tokens.push({
          id: tokenStart,
          expression: content.slice(index + BLOCK_MATH_OPEN.length, closeIndex).trim(),
          displayMode: true,
        });
        markdown += mathPlaceholder(tokenStart, true);
        index = closeIndex + BLOCK_MATH_CLOSE.length;
        continue;
      }
    }

    if (content.startsWith(INLINE_MATH_OPEN, index) && !isEscaped(content, index)) {
      const closeIndex = findClosingDelimiter(content, index + INLINE_MATH_OPEN.length, INLINE_MATH_CLOSE);
      if (closeIndex >= 0) {
        tokens.push({
          id: tokenStart,
          expression: content.slice(index + INLINE_MATH_OPEN.length, closeIndex).trim(),
          displayMode: false,
        });
        markdown += mathPlaceholder(tokenStart, false);
        index = closeIndex + INLINE_MATH_CLOSE.length;
        continue;
      }
    }

    if (
      content[index] === "$"
      && content[index + 1] !== "$"
      && content[index - 1] !== "$"
      && shouldOpenDollarMath(content, index)
    ) {
      const closeIndex = findClosingDollar(content, index + 1, "$");
      if (closeIndex >= 0) {
        tokens.push({
          id: tokenStart,
          expression: content.slice(index + 1, closeIndex).trim(),
          displayMode: false,
        });
        markdown += mathPlaceholder(tokenStart, false);
        index = closeIndex + 1;
        continue;
      }
    }

    markdown += content[index];
    index++;
  }

  return { markdown, tokens };
}

function renderMathToken(token: MathToken): string {
  if (token.expression.length === 0) {
    return "";
  }
  return katex.renderToString(token.expression, {
    displayMode: token.displayMode,
    throwOnError: false,
    strict: "warn",
    output: "html",
  });
}

function restoreMath(html: string, tokens: MathToken[]): string {
  return tokens.reduce((nextHtml, token) => {
    const rendered = renderMathToken(token);
    const blockPattern = new RegExp(`<div\\s+data-math-placeholder="${token.id}"\\s*>\\s*</div>`, "g");
    const inlinePattern = new RegExp(`<span\\s+data-math-placeholder="${token.id}"\\s*>\\s*</span>`, "g");
    return nextHtml
      .replace(blockPattern, rendered)
      .replace(inlinePattern, rendered);
  }, html);
}

export function renderMarkdown(content: string): string {
  if (content.trim().length === 0) {
    return "";
  }

  const { markdown, tokens } = extractMath(content);
  const parsed = markdownParser.parse(markdown);
  const html = restoreMath(typeof parsed === "string" ? parsed : "", tokens);

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["aria-hidden", "target", "rel"],
  });
}
