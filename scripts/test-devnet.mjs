import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { DEFAULT_DEVNET_RPC_URL, displayRpcUrl } from "./deploy-devnet.mjs";

const root = resolve(import.meta.dirname, "..");
const options = parseOptions(process.argv.slice(2));
const payer = isAbsolute(options.payer) ? options.payer : resolve(root, options.payer);
const displayedPayer = displayPath(payer);
if (!existsSync(payer)) throw new Error(`payer keypair does not exist: ${displayedPayer}`);

const rpcUrl = options.rpcUrl ?? process.env.CC_TOKEN_DEVNET_RPC_URL ?? DEFAULT_DEVNET_RPC_URL;
const websocketUrl =
  options.websocketUrl ??
  process.env.CC_TOKEN_DEVNET_WS_URL ??
  (rpcUrl === DEFAULT_DEVNET_RPC_URL ? "wss://api.devnet.solana.com" : null);
if (websocketUrl === null) {
  throw new Error("a custom RPC requires --ws-url or CC_TOKEN_DEVNET_WS_URL");
}

console.log("Devnet test plan");
console.log(`RPC: ${displayRpcUrl(rpcUrl)}`);
console.log(`Program: JD3GWECaXcJGUWnYdcGvKciNyFbsiPH7nw29AsZKEjNW`);
console.log(`Payer keypair: ${displayedPayer}`);
console.log(`Mode: ${options.execute ? "execute" : "preflight only"}`);
console.log("The execute mode creates one permanent scenario and reusable protocol definitions.");

const child = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", "apps/web/test/devnet.integration.ts"],
  {
    cwd: root,
    env: {
      ...process.env,
      CC_TOKEN_DEVNET_EXECUTE: options.execute ? "1" : "0",
      CC_TOKEN_DEVNET_PAYER: payer,
      CC_TOKEN_RPC_URL: rpcUrl,
      CC_TOKEN_WS_URL: websocketUrl,
      CC_TOKEN_DEVNET_RUN_ID: new Date()
        .toISOString()
        .replaceAll(/[^0-9]/g, "")
        .slice(0, 14),
    },
    stdio: "inherit",
  },
);
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;

function displayPath(path) {
  const workspacePath = relative(root, path);
  return workspacePath.startsWith("..") || isAbsolute(workspacePath) ? "<external>" : workspacePath;
}

function parseOptions(args) {
  const values = new Map();
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--execute") {
      execute = true;
      continue;
    }
    if (!["--payer", "--rpc-url", "--ws-url"].includes(argument)) {
      throw new Error(`unknown argument ${argument}`);
    }
    const value = args[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    values.set(argument, value);
    index += 1;
  }
  const payer = values.get("--payer");
  if (!payer) {
    throw new Error(
      "usage: pnpm test:devnet -- --payer <keypair.json> [--rpc-url <url>] [--ws-url <url>] [--execute]",
    );
  }
  return {
    payer,
    rpcUrl: values.get("--rpc-url"),
    websocketUrl: values.get("--ws-url"),
    execute,
  };
}
