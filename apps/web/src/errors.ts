import { generatedClient } from "@cc-token/sdk";
import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
} from "@solana/kit";

export function describeError(error: unknown): string {
  let message = String(error);
  for (let current = error; current instanceof Error; current = current.cause) {
    message = current.message;
    if (isSolanaError(current, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
      if (current.context.statusCode === 429) {
        const retryAfter = current.context.headers.get("retry-after");
        return retryAfter
          ? `The Solana RPC rate limit was reached. Retry after ${retryAfter} seconds.`
          : "The Solana RPC rate limit was reached. Wait briefly and refresh.";
      }
      return `The Solana RPC returned HTTP ${current.context.statusCode}.`;
    }
    if (isSolanaError(current, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
      const { code } = current.context;
      const known =
        code >= 6000 && process.env.NODE_ENV !== "production"
          ? generatedClient.getCcTokenErrorMessage(code as generatedClient.CcTokenError)
          : undefined;
      return `The program refused with error ${code}${known ? `: ${known}` : ""}.`;
    }
  }
  return message;
}
