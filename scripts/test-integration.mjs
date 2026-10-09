import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const anchorConfig = readFileSync(join(root, "Anchor.toml"), "utf8");
const solanaVersion = anchorConfig.match(/^solana_version\s*=\s*"([0-9.]+)"/m)?.[1];
const programId = anchorConfig.match(/^cc_token\s*=\s*"([1-9A-HJ-NP-Za-km-z]+)"/m)?.[1];
if (!solanaVersion || !programId)
  throw new Error("Anchor.toml is missing toolchain or program pins");
const solanaBin = join(
  homedir(),
  ".local/share/solana/install/releases",
  solanaVersion,
  "solana-release/bin",
);
const validator = join(solanaBin, "solana-test-validator");
const ledgerRoot = mkdtempSync(join(tmpdir(), "cc-token-validator-"));
const rpcPort = 18_000 + Math.floor(Math.random() * 8_000);
const rpcUrl = `http://127.0.0.1:${rpcPort}`;
const websocketUrl = `ws://127.0.0.1:${rpcPort + 1}`;
const logs = [];
// Pass test files as arguments to run only those.
const testFiles =
  process.argv.length > 2
    ? process.argv.slice(2)
    : ["packages/sdk/test/local-validator.integration.ts", "apps/web/test/live.integration.ts"];

const generated = spawnSync("pnpm", ["generate:client"], {
  cwd: root,
  env: { ...process.env, PATH: `${solanaBin}${delimiter}${process.env.PATH ?? ""}` },
  stdio: "inherit",
});
if (generated.error) throw generated.error;
if (generated.status !== 0) process.exit(generated.status ?? 1);

const child = spawn(
  validator,
  [
    "--ledger",
    join(ledgerRoot, "ledger"),
    "--reset",
    "--quiet",
    "--account-index",
    "program-id",
    "--account-index",
    "spl-token-owner",
    "--account-index",
    "spl-token-mint",
    "--rpc-port",
    String(rpcPort),
    "--faucet-port",
    String(rpcPort + 2),
    "--dynamic-port-range",
    `${rpcPort + 10}-${rpcPort + 40}`,
    "--bpf-program",
    programId,
    join(root, "target/deploy/cc_token.so"),
  ],
  { cwd: root, env: { ...process.env, PATH: `${solanaBin}${delimiter}${process.env.PATH ?? ""}` } },
);
child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

async function waitForValidator() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`validator exited with ${child.exitCode}\n${logs.join("")}`);
    }
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      });
      const body = await response.json();
      if (body.result === "ok") return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`validator did not become healthy\n${logs.join("")}`);
}

try {
  await waitForValidator();
  const test = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...testFiles], {
    cwd: root,
    env: {
      ...process.env,
      CC_TOKEN_RPC_URL: rpcUrl,
      CC_TOKEN_WS_URL: websocketUrl,
    },
    stdio: "inherit",
  });
  if (test.error) throw test.error;
  process.exitCode = test.status ?? 1;
} finally {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
  rmSync(ledgerRoot, { recursive: true, force: true });
}
