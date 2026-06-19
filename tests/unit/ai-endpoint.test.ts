import assert from "node:assert/strict";
import test from "node:test";
import { chatCompletionsUrl } from "../../src/lib/aiEndpoint";

test("chat completions endpoint accepts common OpenAI-compatible base URL shapes", () => {
  assert.equal(
    chatCompletionsUrl("https://api.yzccc.cloud"),
    "https://api.yzccc.cloud/v1/chat/completions",
  );
  assert.equal(
    chatCompletionsUrl("https://api.yzccc.cloud/v1"),
    "https://api.yzccc.cloud/v1/chat/completions",
  );
  assert.equal(
    chatCompletionsUrl("https://api.yzccc.cloud/v1/"),
    "https://api.yzccc.cloud/v1/chat/completions",
  );
  assert.equal(
    chatCompletionsUrl("https://api.yzccc.cloud/v1/chat/completions"),
    "https://api.yzccc.cloud/v1/chat/completions",
  );
});

test("chat completions endpoint rejects invalid AI base URLs", () => {
  assert.throws(() => chatCompletionsUrl(""), /not configured/u);
  assert.throws(() => chatCompletionsUrl("api.yzccc.cloud/v1"), /absolute http\(s\) URL/u);
  assert.throws(() => chatCompletionsUrl("ftp://api.yzccc.cloud/v1"), /http or https/u);
});
