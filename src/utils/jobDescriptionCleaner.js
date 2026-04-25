// Converts arbitrary job-description input (HTML or plain text) into clean,
// readable plain text suitable for pasting into Notes, Gmail, Docs, or ChatGPT.
//
// Why regex-based tag stripping instead of innerText? innerText depends on
// layout and can behave inconsistently on detached DOM nodes, especially for
// <br> and block-level elements. Manual tag replacement is deterministic.
export function cleanJobDescription(text) {
  if (!text || typeof text !== "string") return "";
  let s = text;

  // Strip HTML if the input looks like markup
  if (/<[a-z][^>]*>/i.test(s)) {
    s = s
      // Remove non-content elements (and their contents) entirely
      .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, "")
      // <br> → newline
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      // List items: prepend bullet marker
      .replace(/<\s*li[^>]*>/gi, "\n• ")
      // Block-level closing tags → newline
      .replace(/<\/\s*(p|div|h[1-6]|section|article|ul|ol|tr)\s*>/gi, "\n")
      // Block-level opening tags → newline (li already handled above)
      .replace(/<\s*(p|div|h[1-6]|section|article|tr)[^>]*>/gi, "\n")
      // Strip everything else (inline tags, attributes, etc.)
      .replace(/<[^>]+>/g, "");

    // Decode HTML entities using a textarea (handles named & numeric refs)
    const decoder = document.createElement("textarea");
    decoder.innerHTML = s;
    s = decoder.value;
  }

  // Normalize whitespace while preserving paragraph / bullet structure
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")      // collapse horizontal whitespace only
    .replace(/\n[^\S\n]+/g, "\n")   // strip leading spaces on each line
    .replace(/[^\S\n]+\n/g, "\n")   // strip trailing spaces on each line
    .replace(/\n{3,}/g, "\n\n")     // cap blank runs at one empty line
    .trim();
}
