import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { POST } from "../api/rpc.ts";

const ENDPOINT = "https://cc-token.example/api/rpc";
const ORIGINAL_RPC_URL = process.env.SOLANA_RPC_URL;
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  if (ORIGINAL_RPC_URL === undefined) delete process.env.SOLANA_RPC_URL;
  else process.env.SOLANA_RPC_URL = ORIGINAL_RPC_URL;
  globalThis.fetch = ORIGINAL_FETCH;
});

function rpcRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://cc-token.example",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const getBalance = {
  jsonrpc: "2.0",
  id: 1,
  method: "getBalance",
  params: ["11111111111111111111111111111111"],
} as const;

test("the proxy is disabled without a server RPC URL", async () => {
  delete process.env.SOLANA_RPC_URL;
  const response = await POST(rpcRequest(getBalance));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "RPC proxy is not configured" });
});

test("cross-origin and non-browser requests are refused", async () => {
  process.env.SOLANA_RPC_URL = "https://provider.example/rpc/private";
  const crossOrigin = await POST(
    rpcRequest(getBalance, { origin: "https://unrelated.example", "sec-fetch-site": "cross-site" }),
  );
  assert.equal(crossOrigin.status, 403);

  const missingOrigin = await POST(
    new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(getBalance),
    }),
  );
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOrigin.headers.get("access-control-allow-origin"), null);
});

test("unsupported methods, notifications and large batches are refused", async () => {
  process.env.SOLANA_RPC_URL = "https://provider.example/rpc/private";
  assert.equal((await POST(rpcRequest({ ...getBalance, method: "requestAirdrop" }))).status, 400);
  const { id: _, ...notification } = getBalance;
  assert.equal((await POST(rpcRequest(notification))).status, 400);
  assert.equal((await POST(rpcRequest(Array.from({ length: 11 }, () => getBalance)))).status, 400);
});

test("oversized requests are refused before reading their body", async () => {
  process.env.SOLANA_RPC_URL = "https://provider.example/rpc/private";
  const response = await POST(rpcRequest(getBalance, { "content-length": "65537" }));
  assert.equal(response.status, 413);
});

test("allowed requests are forwarded without exposing the provider URL", async () => {
  const rpcUrl = "https://provider.example/rpc/private-api-key";
  process.env.SOLANA_RPC_URL = rpcUrl;
  let forwarded = false;
  globalThis.fetch = async (input, init) => {
    forwarded = true;
    assert.equal(String(input), rpcUrl);
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
    assert.deepEqual(JSON.parse(String(init?.body)), getBalance);
    return Response.json(
      { jsonrpc: "2.0", id: 1, error: { code: 429, message: "rate limited" } },
      { status: 429, headers: { "retry-after": "2" } },
    );
  };

  const response = await POST(rpcRequest(getBalance));
  const responseBody = await response.text();
  assert.equal(forwarded, true);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "2");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(responseBody.includes(rpcUrl), false);
});

test("upstream failures do not echo the provider URL", async () => {
  const rpcUrl = "https://provider.example/rpc/private-api-key";
  process.env.SOLANA_RPC_URL = rpcUrl;
  globalThis.fetch = async () => {
    throw new Error(`failed to reach ${rpcUrl}`);
  };

  const response = await POST(rpcRequest(getBalance));
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes(rpcUrl), false);
});
