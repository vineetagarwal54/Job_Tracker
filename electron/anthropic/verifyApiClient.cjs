const { createAnthropicClient } = require("./apiClient.cjs");
const { parseJsonText } = require("./validation.cjs");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_fake" } });
async function main() {
  const normal = createAnthropicClient({ fetchImpl: async () => jsonResponse({ content: [{ type: "text", text: "{}" }], usage: {} }), maxRetries: 0 }); const response = await normal.request({ apiKey: "fake", body: { model: "fake", max_tokens: 1, messages: [] } }); assert(response.content[0].text === "{}", "Normal JSON response failed");
  const sse = ["event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1}}}\n\n", "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"{\\\"ok\\\":true}\"}}\n\n", "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":4}}\n\n", "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"];
  const streamClient = createAnthropicClient({ fetchImpl: async () => new Response(new ReadableStream({ start(controller) { for (const chunk of sse) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } }), maxRetries: 0 }); const streamed = await streamClient.request({ apiKey: "fake", stream: true, body: { model: "fake", max_tokens: 1, messages: [] } }); assert(streamed.text === "{\"ok\":true}" && streamed.stopReason === "end_turn", "SSE parsing failed");
  let authCalls = 0; const auth = createAnthropicClient({ fetchImpl: async () => { authCalls++; return jsonResponse({ type: "error", error: { type: "authentication_error", message: "bad key" } }, 401); } }); try { await auth.request({ apiKey: "fake", body: {} }); } catch (error) { assert(error.code === "authentication_error", "Authentication error was not structured"); } assert(authCalls === 1, "Authentication failure retried");
  let truncated; try { parseJsonText("{\"partial\":", "Sonnet selection", { stopReason: "max_tokens" }); } catch (error) { truncated = error; }
  assert(truncated?.code === "MALFORMED_RESPONSE" && /truncated/i.test(truncated.message), "Token truncation was not diagnosed");
  let refused; try { parseJsonText("Request refused", "Sonnet selection", { stopReason: "refusal" }); } catch (error) { refused = error; }
  assert(refused?.code === "MALFORMED_RESPONSE" && /refused/i.test(refused.message), "Model refusal was not diagnosed");
  let malformed; try { parseJsonText("not-json", "Sonnet selection", { stopReason: "end_turn" }); } catch (error) { malformed = error; }
  assert(malformed?.code === "MALFORMED_RESPONSE" && /end_turn/.test(malformed.message), "Completed malformed JSON lacks a safe diagnostic");
  const timeoutClient = createAnthropicClient({ maxRetries: 0, timeoutMs: 1000, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) });
  let timedOut; try { await timeoutClient.request({ apiKey: "fake", body: {}, timeoutMs: 5 }); } catch (error) { timedOut = error; }
  assert(timedOut?.code === "TIMEOUT", "Per-request timeout override was not enforced");
  console.log(JSON.stringify({ normalJson: true, streamingSse: true, structuredAuthenticationError: true, authenticationNotRetried: true, truncationDiagnosed: true, refusalDiagnosed: true, malformedCompletionDiagnosed: true, perRequestTimeout: true }, null, 2));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
