import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithRetries } from "../dist-electron/tool-download.js";

test("tool downloads retry transient connection failures", async () => {
  let calls = 0;
  const delays = [];
  const response = await fetchWithRetries(
    "https://example.test/tool",
    async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("fetch failed");
      return new Response("tool");
    },
    async (milliseconds) => delays.push(milliseconds),
  );

  assert.equal(await response.text(), "tool");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [500, 1000]);
});

test("tool downloads retry transient HTTP statuses", async () => {
  let calls = 0;
  const response = await fetchWithRetries(
    "https://example.test/tool",
    async () => {
      calls += 1;
      return calls === 1 ? new Response("busy", { status: 503 }) : new Response("tool");
    },
    async () => undefined,
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("tool downloads do not retry permanent HTTP errors", async () => {
  let calls = 0;
  const response = await fetchWithRetries(
    "https://example.test/missing",
    async () => {
      calls += 1;
      return new Response("missing", { status: 404 });
    },
    async () => undefined,
  );

  assert.equal(response.status, 404);
  assert.equal(calls, 1);
});
