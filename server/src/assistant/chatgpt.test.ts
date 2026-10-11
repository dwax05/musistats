import { afterEach, describe, expect, it } from "vitest";
import { ChatGPTError, chatgptAuthorizeUrl, chatgptRedirectUri, completedResponse } from "./chatgpt";

const attempt = { redirectUri: "http://127.0.0.1:5173/api/assistant/chatgpt/callback", hostId: "urn:uuid:host", state: "state", nonce: "nonce", verifier: "verifier" };

describe("ChatGPT sign-in", () => {
  afterEach(() => { delete process.env.CHATGPT_REDIRECT_URI; });

  it("only accepts a 127.0.0.1 loopback callback", () => {
    expect(chatgptRedirectUri()).toBeNull();
    process.env.CHATGPT_REDIRECT_URI = "https://musistats.example/api/assistant/chatgpt/callback";
    expect(chatgptRedirectUri()).toBeNull();
    process.env.CHATGPT_REDIRECT_URI = "http://localhost:5173/api/assistant/chatgpt/callback";
    expect(chatgptRedirectUri()).toBeNull();
    process.env.CHATGPT_REDIRECT_URI = attempt.redirectUri;
    expect(chatgptRedirectUri()).toBe(attempt.redirectUri);
  });

  it("registers a new client on first sign-in and reuses the issued one afterwards", () => {
    const first = new URL(chatgptAuthorizeUrl({ ...attempt, clientId: null })).searchParams;
    expect(first.get("client_id")).toBe("dynamic_agent_client");
    expect(first.get("agent_name_hint")).toBe("MusiStats");
    expect(first.get("scope")).toContain("chatgpt.tokens.use.direct");
    expect(first.get("code_challenge")).toBe("iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ");

    const returning = new URL(chatgptAuthorizeUrl({ ...attempt, clientId: "oaiapp_saved", email: "listener@example.com" })).searchParams;
    expect(returning.get("client_id")).toBe("oaiapp_saved");
    expect(returning.get("login_hint")).toBe("listener@example.com");
    expect(returning.has("agent_name_hint")).toBe(false);
  });
});

describe("ChatGPT plan response stream", () => {
  const event = (value: unknown) => `event: x\ndata: ${JSON.stringify(value)}\n\n`;

  it("returns the response from the terminal completed event", () => {
    const stream = event({ type: "response.output_text.delta", delta: "Hi" }) + event({ type: "response.completed", response: { output: [], output_text: "Hi" } });
    expect(completedResponse(stream)).toEqual({ output: [], output_text: "Hi" });
  });

  it("collects output items from the stream when the completed event carries none", () => {
    const call = { type: "function_call", call_id: "call_1", name: "get_listening_stats", namespace: "musistats", arguments: "{}" };
    const stream = event({ type: "response.output_item.done", item: call }) + event({ type: "response.completed", response: { status: "completed", output: [] } });
    expect(completedResponse(stream)).toEqual({ status: "completed", output: [call] });
  });

  it("surfaces a usage-limit failure that arrives mid-stream", () => {
    const stream = event({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } });
    expect(() => completedResponse(stream)).toThrow(new ChatGPTError("subscription_sharing_usage_limit_exceeded"));
  });

  it("treats a stream that ends without completing as a failure", () => {
    expect(() => completedResponse(event({ type: "response.output_text.delta", delta: "Hi" }))).toThrow(new ChatGPTError("response_incomplete"));
  });
});
