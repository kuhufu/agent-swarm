/**
 * Markdown rendering composable.
 * Uses `marked` + `highlight.js` + `DOMPurify` — the full-featured renderer
 * that was previously only in MessageItem.vue.
 * Replaces the weak regex-based MarkdownRenderer.vue.
 */

import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";

const markdownParser = new Marked({
  gfm: true,
  breaks: true,
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

export function renderMarkdown(content: string): string {
  if (content.trim().length === 0) {
    return "";
  }

  const parsed = markdownParser.parse(content);

  return DOMPurify.sanitize(typeof parsed === "string" ? parsed : "", {
    USE_PROFILES: { html: true },
  });
}
