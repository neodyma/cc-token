import { isSolanaError, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR } from "@solana/kit";

// A public endpoint allows only so many requests in a short time, and a page that opens
// with dozens of reads goes over it. Requests therefore go out a few at a time, and one that
// is turned away with HTTP 429 waits and is sent again instead of failing the page.
export type Pacer = <T>(request: () => Promise<T>) => Promise<T>;

export function createPacer(
  options: Readonly<{ concurrency?: number; attempts?: number; delay?: number }> = {},
): Pacer {
  const { concurrency = 4, attempts = 6, delay = 500 } = options;
  let active = 0;
  const waiting: (() => void)[] = [];

  return async (request) => {
    // A finishing request hands its place straight to the next one in line.
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await request();
        } catch (error) {
          if (
            attempt >= attempts ||
            !isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) ||
            error.context.statusCode !== 429
          ) {
            throw error;
          }
          // The place is kept while waiting, which slows everything else down as well.
          const asked = Number(error.context.headers.get("retry-after"));
          const wait = asked > 0 ? asked * 1_000 : delay * 2 ** (attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      }
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

type Pending = { send: (...options: unknown[]) => Promise<unknown> };

// Reads whose answer several parts of a page ask for at once: the scenario list, the graph
// and the header each look up the same accounts. Anything that must be current, such as a
// blockhash or a transaction's status, is left out.
const SHARED_READS = new Set([
  "getAccountInfo",
  "getBalance",
  "getMultipleAccounts",
  "getProgramAccounts",
  "getSignaturesForAddress",
  "getTokenAccountsByOwner",
]);

// The same RPC, with every request sent through the pacer. A read repeated with the same
// parameters within `shareFor` milliseconds gets the answer of the first instead of being
// sent again. A read made after a transaction names its slot, so it is never one of those.
export function pacedRpc<TRpc extends object>(
  rpc: TRpc,
  pace: Pacer = createPacer(),
  shareFor = 2_000,
): TRpc {
  const recent = new Map<string, Promise<unknown>>();
  return new Proxy(rpc, {
    get(target, property, receiver) {
      const member: unknown = Reflect.get(target, property, receiver);
      if (typeof member !== "function") return member;
      return (...parameters: unknown[]) => {
        const pending = member.apply(target, parameters) as Pending | undefined;
        if (!pending || typeof pending.send !== "function") return pending;
        const shared = typeof property === "string" && SHARED_READS.has(property);
        return {
          ...pending,
          send: (...options: unknown[]) => {
            // An abort signal belongs to one caller, so such a request is not shared.
            const signal = (options[0] as { abortSignal?: unknown } | undefined)?.abortSignal;
            if (!shared || signal !== undefined) return pace(() => pending.send(...options));
            const key = `${property}:${JSON.stringify(parameters, (_, value: unknown) =>
              typeof value === "bigint" ? `${value}n` : value,
            )}`;
            const known = recent.get(key);
            if (known) return known;
            const answer = pace(() => pending.send());
            recent.set(key, answer);
            const forget = () => {
              if (recent.get(key) === answer) recent.delete(key);
            };
            // A failure is forgotten at once, so that asking again tries again.
            answer.then(() => setTimeout(forget, shareFor), forget);
            return answer;
          },
        };
      };
    },
  });
}
