const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_BATCH_SIZE = 10;

const ALLOWED_METHODS = new Set([
  "getAccountInfo",
  "getBalance",
  "getBlockHeight",
  "getEpochInfo",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getSlot",
  "getTokenAccountsByOwner",
  "sendTransaction",
  "simulateTransaction",
]);

type JsonRpcRequest = Readonly<{
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}>;

function jsonError(status: number, error: string): Response {
  return Response.json(
    { error },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function isSameOriginBrowserRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;

  try {
    if (new URL(origin).origin !== new URL(request.url).origin) return false;
  } catch {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === null || fetchSite === "same-origin";
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    request.jsonrpc === "2.0" &&
    (typeof request.id === "string" || typeof request.id === "number") &&
    typeof request.method === "string" &&
    ALLOWED_METHODS.has(request.method) &&
    (request.params === undefined || Array.isArray(request.params))
  );
}

function parsePayload(body: string): JsonRpcRequest | readonly JsonRpcRequest[] | null {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }

  if (Array.isArray(payload)) {
    return payload.length > 0 && payload.length <= MAX_BATCH_SIZE && payload.every(isJsonRpcRequest)
      ? payload
      : null;
  }
  return isJsonRpcRequest(payload) ? payload : null;
}

function configuredRpcUrl(): string | null {
  const value = process.env.SOLANA_RPC_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginBrowserRequest(request)) {
    return jsonError(403, "RPC proxy requests must come from this site");
  }

  const rpcUrl = configuredRpcUrl();
  if (rpcUrl === null) return jsonError(503, "RPC proxy is not configured");

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") return jsonError(415, "Expected application/json");

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      return jsonError(400, "Invalid Content-Length");
    }
    if (bytes > MAX_REQUEST_BYTES) return jsonError(413, "RPC request is too large");
  }

  const encodedBody = new Uint8Array(await request.arrayBuffer());
  if (encodedBody.byteLength > MAX_REQUEST_BYTES) {
    return jsonError(413, "RPC request is too large");
  }

  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(encodedBody);
  } catch {
    return jsonError(400, "RPC request must be valid UTF-8");
  }

  const payload = parsePayload(body);
  if (payload === null) return jsonError(400, "Invalid or unsupported JSON-RPC request");

  let upstream: Response;
  try {
    upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: request.signal,
    });
  } catch {
    return jsonError(502, "The Solana RPC provider could not be reached");
  }

  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "x-content-type-options": "nosniff",
  });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter !== null) headers.set("retry-after", retryAfter);

  return new Response(upstream.body, { status: upstream.status, headers });
}
