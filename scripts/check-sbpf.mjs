import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const artifact = resolve(process.argv[2] ?? "target/deploy/cc_token.so");

try {
  const elf = readFileSync(artifact);
  if (
    elf.length < 64 ||
    !elf.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    elf[4] !== 2 ||
    elf[5] !== 1 ||
    elf.readUInt16LE(18) !== 247
  ) {
    throw new Error("Expected a 64-bit little-endian BPF ELF artifact");
  }

  // Solana records the SBPF version in the ELF64 e_flags field.
  const version = elf.readUInt32LE(48);
  if (version !== 3) {
    throw new Error(`Expected SBPF v3 (ELF flags 0x3), received 0x${version.toString(16)}`);
  }

  console.log(`Verified SBPF v3: ${artifact} (ELF flags 0x3)`);
} catch (error) {
  console.error(`SBPF verification failed: ${error.message}`);
  process.exitCode = 1;
}
