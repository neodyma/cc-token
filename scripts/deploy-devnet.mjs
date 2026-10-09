import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEFAULT_DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const UPGRADEABLE_LOADER_ID = "BPFLoaderUpgradeab1e11111111111111111111111";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const anchorPath = join(root, "Anchor.toml");
const artifactPath = join(root, "target/deploy/cc_token.so");
const idlPath = join(root, "target/idl/cc_token.json");
const defaultProgramKeypair = join(root, "target/deploy/cc_token-keypair.json");

function nextValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseArgs(argv) {
  const options = {
    buffer: undefined,
    deployer: undefined,
    execute: false,
    help: false,
    offline: false,
    programId: undefined,
    programKeypair: undefined,
    rpcUrl: process.env.CC_TOKEN_DEVNET_RPC_URL ?? DEFAULT_DEVNET_RPC_URL,
    status: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--":
        break;
      case "--buffer":
        options.buffer = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--deployer":
        options.deployer = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--execute":
        options.execute = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--offline":
        options.offline = true;
        break;
      case "--program-id":
        options.programId = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--program-keypair":
        options.programKeypair = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--rpc-url":
        options.rpcUrl = nextValue(argv, index, argument);
        index += 1;
        break;
      case "--status":
        options.status = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.status && options.execute) throw new Error("--status cannot be used with --execute");
  if (options.status && options.offline) throw new Error("--status cannot be used with --offline");
  if (options.programId && !options.status) {
    throw new Error("--program-id is only accepted with --status");
  }
  if (options.offline && options.execute) {
    throw new Error("--offline cannot be used with --execute");
  }
  return options;
}

function projectPin(name) {
  const config = readFileSync(anchorPath, "utf8");
  const version = config.match(new RegExp(`^${name}\\s*=\\s*"([0-9.]+)"`, "m"))?.[1];
  if (!version) throw new Error(`Anchor.toml is missing ${name}`);
  return version;
}

function validateProgramId(value) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    throw new Error("program ID is not a base58 public key");
  }
  return value;
}

export function readBuiltProgramId(path = idlPath) {
  let idl;
  try {
    idl = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read built IDL at ${path}: ${error.message}`);
  }
  if (typeof idl.address !== "string") throw new Error("built IDL does not contain an address");
  return validateProgramId(idl.address);
}

function resolveExistingPath(input, label) {
  const path = isAbsolute(input) ? input : resolve(root, input);
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  return realpathSync(path);
}

export function validateRpcUrl(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("devnet RPC URL must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("devnet RPC URL cannot contain userinfo or a fragment");
  }
  return url;
}

export function displayRpcUrl(input) {
  const url = validateRpcUrl(input);
  return `${url.origin}${url.pathname === "/" ? "" : "/…"}${url.search ? "?…" : ""}`;
}

function pinnedSolanaTools(solanaVersion) {
  const bin = join(
    homedir(),
    ".local/share/solana/install/releases",
    solanaVersion,
    "solana-release/bin",
  );
  return {
    bin,
    solana: existsSync(join(bin, "solana")) ? join(bin, "solana") : "solana",
    solanaKeygen: existsSync(join(bin, "solana-keygen"))
      ? join(bin, "solana-keygen")
      : "solana-keygen",
  };
}

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: root,
    encoding: options.encoding ?? "utf8",
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.stdio,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    throw new Error(`${basename(commandName)} failed${detail ? `: ${detail}` : ""}`);
  }
  return (result.stdout ?? "").trim();
}

function requireSolanaVersion(solana, expected, env) {
  const actual = command(solana, ["--version"], { env });
  if (actual.split(/\s+/)[1] !== expected) {
    throw new Error(`Expected Solana CLI ${expected}; received ${actual || "no version"}`);
  }
  return actual;
}

function publicKeyFor(solanaKeygen, keypair, env) {
  return command(solanaKeygen, ["pubkey", keypair], { env });
}

function encodeBase58(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}

function decodeAccountData(account, label) {
  if (!Array.isArray(account.data) || account.data[1] !== "base64") {
    throw new Error(`${label} returned unexpected account encoding`);
  }
  return Buffer.from(account.data[0], "base64");
}

export function parseUpgradeableProgram(programAccount, programDataAccount) {
  if (!programAccount.executable || programAccount.owner !== UPGRADEABLE_LOADER_ID) {
    throw new Error("program address exists but is not an upgradeable executable");
  }
  const program = decodeAccountData(programAccount, "program");
  if (program.length < 36 || program.readUInt32LE(0) !== 2) {
    throw new Error("program account has invalid upgradeable-loader state");
  }
  const programDataAddress = encodeBase58(program.subarray(4, 36));
  if (programDataAccount.owner !== UPGRADEABLE_LOADER_ID) {
    throw new Error("program data account has an unexpected owner");
  }
  const data = decodeAccountData(programDataAccount, "program data");
  if (data.length < 13 || data.readUInt32LE(0) !== 3) {
    throw new Error("program data account has invalid upgradeable-loader state");
  }
  const option = data[12];
  if (option !== 0 && option !== 1) throw new Error("program data authority is malformed");
  if (option === 1 && data.length < 45) throw new Error("program data authority is truncated");
  return {
    authority: option === 1 ? encodeBase58(data.subarray(13, 45)) : null,
    programDataAddress,
    slot: data.readBigUInt64LE(4).toString(),
  };
}

async function rpcRequest(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC ${method} failed: ${body.error.message ?? "unknown error"}`);
  return body.result;
}

async function accountInfo(rpcUrl, address, length) {
  const options = { commitment: "finalized", encoding: "base64" };
  if (length !== undefined) options.dataSlice = { offset: 0, length };
  return (await rpcRequest(rpcUrl, "getAccountInfo", [address, options])).value;
}

async function deploymentState(rpcUrl, programId) {
  const programAccount = await accountInfo(rpcUrl, programId, 36);
  if (programAccount === null) return null;
  if (!programAccount.executable || programAccount.owner !== UPGRADEABLE_LOADER_ID) {
    throw new Error("program address exists but is not an upgradeable executable");
  }
  const program = decodeAccountData(programAccount, "program");
  if (program.length < 36 || program.readUInt32LE(0) !== 2) {
    throw new Error("program account has invalid upgradeable-loader state");
  }
  const programDataAddress = encodeBase58(program.subarray(4, 36));
  const programDataAccount = await accountInfo(rpcUrl, programDataAddress, 45);
  if (programDataAccount === null) throw new Error("program data account is missing");
  return parseUpgradeableProgram(programAccount, programDataAccount);
}

export function requireDevnetGenesis(genesisHash) {
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error(`RPC genesis hash is ${genesisHash}, expected devnet ${DEVNET_GENESIS_HASH}`);
  }
  return genesisHash;
}

export function planDeployment({ deployerAddress, execute, existing, programId, programKeypair }) {
  if (existing?.authority === null) throw new Error("the deployed program is immutable");
  if (existing && deployerAddress && existing.authority !== deployerAddress) {
    throw new Error(`deployer ${deployerAddress} is not upgrade authority ${existing.authority}`);
  }
  if (execute && !deployerAddress) throw new Error("--deployer is required with --execute");
  if (execute && !existing && !programKeypair) {
    throw new Error("initial deployment requires a matching --program-keypair");
  }
  return {
    operation: existing ? "upgrade" : "initial deployment",
    programTarget: existing ? programId : programKeypair,
  };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sol(value) {
  const whole = value / 1_000_000_000n;
  const fraction = (value % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} SOL`;
}

export function buildDeployArgs({ artifact, buffer, deployer, programTarget, rpcUrl }) {
  const args = [
    "program",
    "deploy",
    artifact,
    "--url",
    rpcUrl,
    "--program-id",
    programTarget,
    "--keypair",
    deployer,
    "--fee-payer",
    deployer,
    "--upgrade-authority",
    deployer,
    "--commitment",
    "finalized",
    "--output",
    "json",
  ];
  if (buffer) args.push("--buffer", buffer);
  return args;
}

function usage() {
  console.log(`Usage:
  pnpm devnet:status [-- --program-id <address>] [--rpc-url <url>]
  pnpm deploy:devnet -- --offline [--program-keypair <path>]
  pnpm deploy:devnet -- [--deployer <path>] [--program-keypair <path>]
                         [--buffer <path>] [--rpc-url <url>] [--execute]

Deployment is a dry run unless --execute is supplied. Signer paths may be absolute or relative to
the repository root.`);
}

async function inspectDevnet(rpcUrl, programId) {
  requireDevnetGenesis(await rpcRequest(rpcUrl, "getGenesisHash"));
  return deploymentState(rpcUrl, programId);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return usage();

  const rpcUrl = validateRpcUrl(options.rpcUrl).toString();
  if (options.status) {
    const programId = options.programId
      ? validateProgramId(options.programId)
      : readBuiltProgramId();
    const existing = await inspectDevnet(rpcUrl, programId);
    console.log(`Cluster: devnet (${DEVNET_GENESIS_HASH})`);
    console.log(`RPC: ${displayRpcUrl(rpcUrl)}`);
    console.log(`Program: ${programId}`);
    console.log(
      existing
        ? `Status: deployed at ${existing.programDataAddress}; authority ${existing.authority ?? "none (immutable)"}`
        : "Status: not deployed",
    );
    return;
  }

  const solanaVersionPin = projectPin("solana_version");
  const tools = pinnedSolanaTools(solanaVersionPin);
  const env = {
    ...process.env,
    NO_DNA: "1",
    PATH: `${tools.bin}${delimiter}${process.env.PATH ?? ""}`,
  };
  const solanaVersion = requireSolanaVersion(tools.solana, solanaVersionPin, env);

  command("pnpm", ["build"], { env, stdio: "inherit" });
  if (!existsSync(artifactPath)) throw new Error("build did not produce target/deploy/cc_token.so");
  const programId = readBuiltProgramId();
  const artifactBytes = statSync(artifactPath).size;
  const artifactSha256 = sha256(artifactPath);
  const gitCommit = command("git", ["rev-parse", "HEAD"]);
  const gitTree = command("git", ["status", "--porcelain"]) ? "dirty" : "clean";

  let programKeypair;
  let programKeypairAddress;
  const programKeypairInput =
    options.programKeypair ??
    (existsSync(defaultProgramKeypair) ? defaultProgramKeypair : undefined);
  if (programKeypairInput) {
    programKeypair = resolveExistingPath(programKeypairInput, "program keypair");
    programKeypairAddress = publicKeyFor(tools.solanaKeygen, programKeypair, env);
    if (options.programKeypair && programKeypairAddress !== programId) {
      throw new Error(`program keypair is ${programKeypairAddress}, built program is ${programId}`);
    }
    if (programKeypairAddress !== programId) programKeypair = undefined;
  }

  let deployer;
  let deployerAddress;
  if (options.deployer) {
    deployer = resolveExistingPath(options.deployer, "deployer keypair");
    deployerAddress = publicKeyFor(tools.solanaKeygen, deployer, env);
  }
  const buffer = options.buffer ? resolveExistingPath(options.buffer, "buffer keypair") : undefined;

  if (options.offline) {
    console.log("Deployment preparation (offline)");
    console.log(`Solana CLI: ${solanaVersion}`);
    console.log(`Program: ${programId}`);
    console.log(`Matching program keypair: ${programKeypair ? "available" : "not supplied"}`);
    console.log(`Artifact: ${artifactBytes} bytes, sha256 ${artifactSha256}`);
    console.log(`Git commit: ${gitCommit} (${gitTree} tree)`);
    console.log("Network and authority were not checked; no transaction was submitted.");
    return;
  }

  const existing = await inspectDevnet(rpcUrl, programId);
  const plan = planDeployment({
    deployerAddress,
    execute: options.execute,
    existing,
    programId,
    programKeypair,
  });
  const rentLamports = BigInt(
    await rpcRequest(rpcUrl, "getMinimumBalanceForRentExemption", [artifactBytes]),
  );
  let deployerBalance;
  if (deployerAddress) {
    deployerBalance = BigInt((await rpcRequest(rpcUrl, "getBalance", [deployerAddress])).value);
  }

  console.log("Deployment plan");
  console.log(`Cluster: devnet (${DEVNET_GENESIS_HASH})`);
  console.log(`RPC: ${displayRpcUrl(rpcUrl)}`);
  console.log(`Program: ${programId}`);
  console.log(`Operation: ${plan.operation}`);
  console.log(`Artifact: ${artifactBytes} bytes, sha256 ${artifactSha256}`);
  console.log(`Git commit: ${gitCommit} (${gitTree} tree)`);
  console.log(`Artifact-length rent reference: ${sol(rentLamports)}`);
  if (!existing) {
    console.log(`Matching program keypair: ${programKeypair ? "available" : "not supplied"}`);
  }
  if (deployerAddress) console.log(`Deployer / upgrade authority: ${deployerAddress}`);
  if (deployerBalance !== undefined) console.log(`Deployer balance: ${sol(deployerBalance)}`);
  console.log(`Recoverable buffer: ${buffer ? "explicit" : "not supplied"}`);

  if (!options.execute) {
    console.log("Dry run complete; no transaction was submitted.");
    return;
  }

  const args = buildDeployArgs({
    artifact: artifactPath,
    buffer,
    deployer,
    programTarget: plan.programTarget,
    rpcUrl,
  });
  const output = command(tools.solana, args, { env });
  console.log(output);

  let confirmed;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    confirmed = await deploymentState(rpcUrl, programId);
    if (confirmed) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  if (!confirmed) {
    throw new Error(
      "deployment command succeeded but program was not found at finalized commitment",
    );
  }
  if (confirmed.authority !== deployerAddress) {
    throw new Error(
      `confirmed upgrade authority is ${confirmed.authority}, expected ${deployerAddress}`,
    );
  }

  let deploymentResult;
  try {
    deploymentResult = JSON.parse(output);
  } catch {
    deploymentResult = { output };
  }
  const receiptDirectory = join(root, "target/deployments/devnet");
  mkdirSync(receiptDirectory, { recursive: true });
  const receiptPath = join(receiptDirectory, `${Date.now()}-${gitCommit.slice(0, 12)}.json`);
  writeFileSync(
    receiptPath,
    `${JSON.stringify(
      {
        artifact: { bytes: artifactBytes, sha256: artifactSha256 },
        authority: deployerAddress,
        cluster: "devnet",
        deploymentResult,
        genesisHash: DEVNET_GENESIS_HASH,
        gitCommit,
        gitTree,
        program: { id: programId, ...confirmed },
        rpc: displayRpcUrl(rpcUrl),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Confirmed deployment; receipt: ${receiptPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Devnet deployment failed: ${error.message}`);
    process.exitCode = 1;
  });
}
