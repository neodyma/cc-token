import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_DEVNET_RPC_URL,
  DEVNET_GENESIS_HASH,
  UPGRADEABLE_LOADER_ID,
  buildDeployArgs,
  displayRpcUrl,
  parseArgs,
  parseUpgradeableProgram,
  planDeployment,
  readBuiltProgramId,
  requireDevnetGenesis,
  validateRpcUrl,
} from "./deploy-devnet.mjs";

const PROGRAM_ID = "11111111111111111111111111111111";
const AUTHORITY = "SysvarC1ock11111111111111111111111111111111";

test("parses non-signing and execution modes without implicit confirmation values", () => {
  assert.equal(parseArgs([]).rpcUrl, DEFAULT_DEVNET_RPC_URL);
  assert.equal(parseArgs(["--", "--offline"]).offline, true);
  assert.equal(parseArgs(["--execute", "--deployer", "deployer.json"]).execute, true);
  assert.equal(parseArgs(["--status", "--program-id", PROGRAM_ID]).programId, PROGRAM_ID);
  assert.throws(() => parseArgs(["--execute", "--offline"]), /cannot be used/);
  assert.throws(() => parseArgs(["--execute", "--status"]), /cannot be used/);
  assert.throws(() => parseArgs(["--program-id", PROGRAM_ID]), /only accepted with --status/);
  assert.throws(() => parseArgs(["--rpc-url"]), /requires a value/);
  assert.throws(() => parseArgs(["--mainnet"]), /Unknown argument/);
});

test("reads program identity from structured build output", () => {
  const directory = mkdtempSync(join(tmpdir(), "cc-token-idl-test-"));
  const idl = join(directory, "cc_token.json");
  writeFileSync(idl, JSON.stringify({ address: PROGRAM_ID }));
  assert.equal(readBuiltProgramId(idl), PROGRAM_ID);

  writeFileSync(idl, JSON.stringify({ metadata: {} }));
  assert.throws(() => readBuiltProgramId(idl), /does not contain an address/);

  writeFileSync(idl, "{");
  assert.throws(() => readBuiltProgramId(idl), /cannot read built IDL/);
});

test("identifies initial deployment requirements and target", () => {
  assert.deepEqual(
    planDeployment({
      execute: false,
      existing: null,
      programId: PROGRAM_ID,
    }),
    { operation: "initial deployment", programTarget: undefined },
  );
  assert.throws(
    () =>
      planDeployment({
        execute: true,
        existing: null,
        programId: PROGRAM_ID,
        programKeypair: "/keys/program.json",
      }),
    /--deployer is required/,
  );
  assert.throws(
    () =>
      planDeployment({
        deployerAddress: AUTHORITY,
        execute: true,
        existing: null,
        programId: PROGRAM_ID,
      }),
    /matching --program-keypair/,
  );
  assert.deepEqual(
    planDeployment({
      deployerAddress: AUTHORITY,
      execute: true,
      existing: null,
      programId: PROGRAM_ID,
      programKeypair: "/keys/program.json",
    }),
    { operation: "initial deployment", programTarget: "/keys/program.json" },
  );
});

test("uses on-chain authority and program address for upgrades", () => {
  assert.deepEqual(
    planDeployment({
      deployerAddress: AUTHORITY,
      execute: true,
      existing: { authority: AUTHORITY },
      programId: PROGRAM_ID,
    }),
    { operation: "upgrade", programTarget: PROGRAM_ID },
  );
  assert.throws(
    () =>
      planDeployment({
        deployerAddress: PROGRAM_ID,
        execute: false,
        existing: { authority: AUTHORITY },
        programId: PROGRAM_ID,
      }),
    /not upgrade authority/,
  );
  assert.throws(
    () =>
      planDeployment({
        deployerAddress: AUTHORITY,
        execute: false,
        existing: { authority: null },
        programId: PROGRAM_ID,
      }),
    /immutable/,
  );
});

test("deployment command supplies the selected target and every signer", () => {
  const args = buildDeployArgs({
    artifact: "/repo/program.so",
    buffer: "/keys/buffer.json",
    deployer: "/keys/deployer.json",
    programTarget: "/keys/program.json",
    rpcUrl: DEFAULT_DEVNET_RPC_URL,
  });
  assert.deepEqual(args.slice(0, 3), ["program", "deploy", "/repo/program.so"]);
  assert.equal(args[args.indexOf("--program-id") + 1], "/keys/program.json");
  assert.equal(args[args.indexOf("--keypair") + 1], "/keys/deployer.json");
  assert.equal(args[args.indexOf("--fee-payer") + 1], "/keys/deployer.json");
  assert.equal(args[args.indexOf("--upgrade-authority") + 1], "/keys/deployer.json");
  assert.equal(args[args.indexOf("--buffer") + 1], "/keys/buffer.json");
  assert.equal(args.includes("--skip-preflight"), false);
  assert.equal(args.includes("--final"), false);
});

test("checks the devnet cluster and redacts RPC credentials from output", () => {
  assert.equal(requireDevnetGenesis(DEVNET_GENESIS_HASH), DEVNET_GENESIS_HASH);
  assert.throws(() => requireDevnetGenesis("another-cluster"), /expected devnet/);
  assert.equal(validateRpcUrl(DEFAULT_DEVNET_RPC_URL).hostname, "api.devnet.solana.com");
  assert.equal(validateRpcUrl("http://127.0.0.1:8899").port, "8899");
  assert.equal(
    displayRpcUrl("https://rpc.example.test/project/route?access=value"),
    "https://rpc.example.test/…?…",
  );
  assert.throws(() => validateRpcUrl("ftp://rpc.example.test"), /HTTP or HTTPS/);
  assert.throws(() => validateRpcUrl("https://user:secret@rpc.example.test"), /userinfo/);
});

test("decodes upgradeable-loader state and rejects malformed metadata", () => {
  const programData = Buffer.alloc(32, 3);
  const authority = Buffer.alloc(32, 7);
  const program = Buffer.alloc(36);
  program.writeUInt32LE(2, 0);
  programData.copy(program, 4);
  const data = Buffer.alloc(45);
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(42n, 4);
  data[12] = 1;
  authority.copy(data, 13);
  const programAccount = {
    data: [program.toString("base64"), "base64"],
    executable: true,
    owner: UPGRADEABLE_LOADER_ID,
  };
  const programDataAccount = {
    data: [data.toString("base64"), "base64"],
    owner: UPGRADEABLE_LOADER_ID,
  };

  const parsed = parseUpgradeableProgram(programAccount, programDataAccount);
  assert.equal(parsed.slot, "42");
  assert.ok(parsed.programDataAddress.length > 30);
  assert.ok(parsed.authority.length > 30);

  data[12] = 0;
  assert.equal(
    parseUpgradeableProgram(programAccount, {
      ...programDataAccount,
      data: [data.toString("base64"), "base64"],
    }).authority,
    null,
  );

  program.writeUInt32LE(1, 0);
  assert.throws(
    () =>
      parseUpgradeableProgram(
        { ...programAccount, data: [program.toString("base64"), "base64"] },
        programDataAccount,
      ),
    /invalid upgradeable-loader state/,
  );
});
