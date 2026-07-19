const API_URL = "https://api.anthropic.com/v1/messages";

class AnthropicApiError extends Error {
  constructor(message, details = {}) { super(message); this.name = "AnthropicApiError"; Object.assign(this, details); }
}
const transient = (status) => status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 529;
const delay = (ms, signal) => new Promise((resolve, reject) => { const id = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(id); reject(new AnthropicApiError("Request cancelled.", { code: "CANCELLED" })); }, { once: true }); });

function linkedController(signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  return { controller, cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
}

async function errorFromResponse(response) {
  let body = null; try { body = await response.json(); } catch {}
  const code = body?.error?.type || `HTTP_${response.status}`;
  return new AnthropicApiError(body?.error?.message || `Anthropic request failed (${response.status}).`, { code, status: response.status, requestId: body?.request_id || response.headers.get("request-id"), retryable: transient(response.status) });
}

async function parseSse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new AnthropicApiError("Anthropic returned no response stream.", { code: "MALFORMED_RESPONSE" });
  const decoder = new TextDecoder(); let buffer = ""; let text = ""; let usage = null; let stopReason = null;
  const consume = (frame) => {
    const line = frame.split(/\r?\n/).find((item) => item.startsWith("data:")); if (!line) return;
    let event; try { event = JSON.parse(line.slice(5).trim()); } catch { throw new AnthropicApiError("Anthropic returned malformed streaming data.", { code: "MALFORMED_RESPONSE" }); }
    if (event.type === "error") throw new AnthropicApiError(event.error?.message || "Anthropic stream failed.", { code: event.error?.type || "STREAM_ERROR", retryable: event.error?.type === "overloaded_error" });
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") text += event.delta.text;
    if (event.type === "message_start") usage = event.message?.usage || usage;
    if (event.type === "message_delta") { usage = { ...(usage || {}), ...(event.usage || {}) }; stopReason = event.delta?.stop_reason || stopReason; }
  };
  while (true) { const { done, value } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done }); const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || ""; for (const frame of frames) consume(frame); if (done) break; }
  if (buffer.trim()) consume(buffer);
  return { text, usage, stopReason };
}

function createAnthropicClient({ fetchImpl = globalThis.fetch, maxRetries = 2, timeoutMs = 60000 } = {}) {
  async function request({ apiKey, body, stream = false, signal }) {
    if (!apiKey) throw new AnthropicApiError("Anthropic API key is not configured.", { code: "KEY_NOT_CONFIGURED" });
    for (let attempt = 0; ; attempt++) {
      const linked = linkedController(signal, timeoutMs);
      try {
        const response = await fetchImpl(API_URL, { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ ...body, stream }), signal: linked.controller.signal });
        if (!response.ok) { const error = await errorFromResponse(response); if (error.retryable && attempt < maxRetries) { linked.cleanup(); await delay(Math.min(4000, 500 * 2 ** attempt), signal); continue; } throw error; }
        if (stream) return await parseSse(response);
        const result = await response.json(); if (!Array.isArray(result.content)) throw new AnthropicApiError("Anthropic returned a malformed response.", { code: "MALFORMED_RESPONSE" });
        return result;
      } catch (error) {
        if (error instanceof AnthropicApiError) throw error;
        if (signal?.aborted) throw new AnthropicApiError("Request cancelled.", { code: "CANCELLED" });
        if (linked.controller.signal.aborted) throw new AnthropicApiError("Anthropic request timed out.", { code: "TIMEOUT", retryable: true });
        if (attempt < maxRetries) { linked.cleanup(); await delay(Math.min(4000, 500 * 2 ** attempt), signal); continue; }
        throw new AnthropicApiError("Could not reach Anthropic.", { code: "NETWORK_ERROR", retryable: true });
      } finally { linked.cleanup(); }
    }
  }
  return { request };
}
module.exports = { AnthropicApiError, createAnthropicClient };
