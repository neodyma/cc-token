import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const result = spawnSync(
  "cargo",
  ["+1.97.1", "test", "--manifest-path", "tests/litesvm/Cargo.toml", "--locked"],
  {
    cwd: root,
    env: { ...process.env, CARGO_TARGET_DIR: join(root, "target/litesvm"), NO_DNA: "1" },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
