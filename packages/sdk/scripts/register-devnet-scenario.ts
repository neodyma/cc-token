import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  type ReadonlyUint8Array,
} from "@solana/kit";

import {
  CC_TOKEN_PROGRAM_ADDRESS,
  createKitExecutionAdapter,
  executeConfirmedPlan,
  fetchVerifiedPositionDefinition,
  fetchVerifiedScenarioDefinition,
  generatedClient,
  getRegisterScenarioDefinitionInstruction,
  getScenarioAddress,
  MemoryPlanCheckpointStore,
  SCENARIO_DEFINITION_SPACE,
  validateScenarioName,
} from "../src/index.ts";

const DEFAULT_RPC = "https://api.devnet.solana.com";
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

type Options = Readonly<{
  deployer: string;
  anchorPositionId: Uint8Array;
  name: string;
  rpcUrl: string;
  execute: boolean;
}>;

const options = parseOptions(process.argv.slice(2));
validateScenarioName(options.name);

const secret: unknown = JSON.parse(readFileSync(resolve(options.deployer), "utf8"));
if (
  !Array.isArray(secret) ||
  secret.length !== 64 ||
  secret.some((byte) => !Number.isInteger(byte))
) {
  throw new Error("deployer must be a 64-byte Solana keypair JSON file");
}
const creator = await createKeyPairSignerFromBytes(Uint8Array.from(secret));
const rpc = createSolanaRpc(options.rpcUrl);

const genesisHash = await rpc.getGenesisHash().send();
if (genesisHash !== DEVNET_GENESIS_HASH) {
  throw new Error(`RPC genesis hash is ${genesisHash}, expected devnet ${DEVNET_GENESIS_HASH}`);
}
const program = await rpc
  .getAccountInfo(CC_TOKEN_PROGRAM_ADDRESS, { encoding: "base64", commitment: "confirmed" })
  .send();
if (program.value === null || !program.value.executable) {
  throw new Error(`cc-token program ${CC_TOKEN_PROGRAM_ADDRESS} is not deployed on devnet`);
}

const anchor = await fetchVerifiedPositionDefinition(rpc, options.anchorPositionId, {
  commitment: "confirmed",
});
const [scenarioAddress] = await getScenarioAddress(creator.address, options.anchorPositionId);
const existing = await generatedClient.fetchMaybeScenarioDefinition(rpc, scenarioAddress, {
  commitment: "confirmed",
});
if (existing.exists) {
  const verified = await fetchVerifiedScenarioDefinition(rpc, scenarioAddress, {
    commitment: "confirmed",
  });
  if (verified.data.name !== options.name) {
    throw new Error(
      `scenario ${scenarioAddress} already exists as “${verified.data.name}”; use the creator rename instruction instead`,
    );
  }
}
const rent = await rpc.getMinimumBalanceForRentExemption(SCENARIO_DEFINITION_SPACE).send();
const balance = await rpc.getBalance(creator.address, { commitment: "confirmed" }).send();

console.log("Scenario registration plan");
console.log(`RPC: ${options.rpcUrl}`);
console.log(`Program: ${CC_TOKEN_PROGRAM_ADDRESS}`);
console.log(`Creator / payer: ${creator.address}`);
console.log(`Creator balance: ${Number(balance.value) / 1_000_000_000} SOL`);
console.log(`Anchor position: ${toHex(anchor.data.positionId)}`);
console.log(`Collateral: ${anchor.data.collateralMint}`);
console.log(`Collection: ${toHex(anchor.data.collectionId)}`);
console.log(`Scenario: ${scenarioAddress}`);
console.log(`Name: ${options.name}`);
console.log(`Operation: ${existing.exists ? "idempotent registration" : "new registration"}`);
console.log(`Rent reference: ${Number(rent) / 1_000_000_000} SOL`);

if (!options.execute) {
  console.log("Dry run complete; no transaction was submitted.");
  process.exit(0);
}

const instruction = await getRegisterScenarioDefinitionInstruction({
  payer: creator,
  creator,
  anchorPositionId: options.anchorPositionId,
  name: options.name,
});
const planId = `register-scenario:${scenarioAddress}`;
const step = {
  id: `${planId}:execute`,
  planId,
  kind: "execute" as const,
  instructions: [instruction] as const,
};
const adapter = createKitExecutionAdapter({
  rpc,
  feePayer: creator,
  checkpointStore: new MemoryPlanCheckpointStore(),
  version: 0,
  commitment: "confirmed",
  async refetch() {
    return fetchVerifiedScenarioDefinition(rpc, scenarioAddress, { commitment: "confirmed" });
  },
});
const [receipt] = await executeConfirmedPlan([step], adapter);
console.log(
  JSON.stringify(
    {
      programId: CC_TOKEN_PROGRAM_ADDRESS,
      scenario: scenarioAddress,
      creator: creator.address,
      anchorPositionId: toHex(options.anchorPositionId),
      name: options.name,
      signature: receipt!.signature,
    },
    null,
    2,
  ),
);

function parseOptions(args: readonly string[]): Options {
  const values = new Map<string, string>();
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") continue;
    if (argument === "--execute") {
      execute = true;
      continue;
    }
    if (!["--deployer", "--anchor-position-id", "--name", "--rpc"].includes(argument)) {
      throw new Error(`unknown argument ${argument}`);
    }
    const value = args[index + 1];
    if (!value) throw new Error(`${argument} requires a value`);
    values.set(argument, value);
    index += 1;
  }
  const deployer = values.get("--deployer");
  const anchor = values.get("--anchor-position-id");
  const name = values.get("--name");
  if (!deployer || !anchor || !name) {
    throw new Error(
      "usage: --deployer <keypair.json> --anchor-position-id <64 hex characters> --name <name> [--rpc <url>] [--execute]",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(anchor)) {
    throw new Error("anchor position ID must contain 64 hexadecimal characters");
  }
  return {
    deployer,
    anchorPositionId: Uint8Array.from(Buffer.from(anchor, "hex")),
    name,
    rpcUrl: values.get("--rpc") ?? DEFAULT_RPC,
    execute,
  };
}

function toHex(value: ReadonlyUint8Array): string {
  return Buffer.from(Uint8Array.from(value)).toString("hex");
}
