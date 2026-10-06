import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = readFileSync(join(root, "Anchor.toml"), "utf8");
const executableSuffix = process.platform === "win32" ? ".exe" : "";

function pin(name) {
  const version = config.match(new RegExp(`^${name}\\s*=\\s*"([0-9.]+)"`, "m"))?.[1];
  if (!version) throw new Error(`Missing ${name} pin in Anchor.toml`);
  return version;
}

function requireVersion(command, expected, env) {
  const result = spawnSync(command, ["--version"], { cwd: root, env, encoding: "utf8" });
  const actual = result.stdout?.trim() ?? "";
  if (result.error || result.status !== 0 || actual.split(/\s+/)[1] !== expected) {
    throw new Error(`Expected ${command} version ${expected}; received ${actual || "no version"}`);
  }
  console.log(actual);
}

try {
  const anchorVersion = pin("anchor_version");
  const solanaVersion = pin("solana_version");
  const avmBinary = join(homedir(), ".avm", "bin", `anchor-${anchorVersion}${executableSuffix}`);
  const anchor = existsSync(avmBinary) ? avmBinary : "anchor";
  const solanaBin = join(
    homedir(),
    ".local/share/solana/install/releases",
    solanaVersion,
    "solana-release/bin",
  );
  const env = { ...process.env };
  if (existsSync(solanaBin)) env.PATH = `${solanaBin}${delimiter}${env.PATH ?? ""}`;

  // Bypass older AVM launchers that parse flags before handing off to the workspace pin.
  requireVersion(anchor, anchorVersion, env);
  requireVersion("solana", solanaVersion, env);
  const build = spawnSync(
    anchor,
    ["build", "--arch", "v3", "--tools-version", "v1.57", ...process.argv.slice(2)],
    { cwd: root, env, stdio: "inherit" },
  );
  if (build.error) throw build.error;
  if (build.status !== 0) process.exit(build.status ?? 1);

  const verification = spawnSync(process.execPath, [join(root, "scripts/check-sbpf.mjs")], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (verification.error) throw verification.error;
  process.exitCode = verification.status ?? 1;
} catch (error) {
  console.error(`Build setup failed: ${error.message}`);
  console.error("Install the versions in Anchor.toml; see docs/toolchain.md.");
  process.exitCode = 1;
}
