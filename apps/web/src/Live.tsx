import { CC_TOKEN_PROGRAM_ADDRESS } from "@cc-token/sdk";
import { useConnectedWallet, WalletReadyGate } from "@solana/kit-plugin-wallet/react";
import type { Address } from "@solana/kit";
import { useState, type ReactNode } from "react";

import { Panel } from "./components.tsx";
import { LiveWorkspace } from "./LiveWorkspace.tsx";
import { ROUTES } from "./routes.ts";
import { client, CLUSTER } from "./solana.ts";
import { useProgramDeployed } from "./Wallet.tsx";

// What each action is on-chain. Shown until the program and a wallet are both available.
const ACTIONS: readonly Readonly<{ action: string; detail: string; instructions: string }>[] = [
  {
    action: "Register a collateral token",
    detail: "Once per token, by anyone. Creates the vault that holds deposits.",
    instructions: "register_collateral",
  },
  {
    action: "Define a question",
    detail: "Names the resolver and the number of possible results.",
    instructions: "prepare_condition",
  },
  {
    action: "Deposit and split",
    detail: "Locks collateral for a full set of positions, or cuts a position into narrower ones.",
    instructions: "split_from_collateral, split_position",
  },
  {
    action: "Merge and cash out",
    detail: "Joins pieces into a broader position, or a full set back into collateral.",
    instructions: "merge_positions, merge_to_collateral",
  },
  {
    action: "Transfer",
    detail: "Sends positions to another owner, one or several at a time.",
    instructions: "transfer_position, batch_transfer_positions",
  },
  {
    action: "Report a result",
    detail: "The resolver publishes the payout weights; once final they cannot change.",
    instructions: "report_payouts",
  },
  {
    action: "Redeem",
    detail: "Turns a position into its payout, one question at a time.",
    instructions: "redeem_position, redeem_to_collateral",
  },
  {
    action: "Wrap as an ordinary token",
    detail: "Exchanges a position for a Token-2022 token that other programs can hold, and back.",
    instructions: "initialize_wrapper, wrap_position, unwrap_position",
  },
];

export function Live() {
  const deployed = useProgramDeployed();
  const live = deployed.state === "ready" && deployed.value;
  const connected = useConnectedWallet(client);
  const ready = live && connected !== null;

  const status = (
    <ul className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-line bg-panel px-4 py-2 text-sm">
      <Check state="ok" label="Network">
        {CLUSTER.name}
      </Check>
      <Check
        state={deployed.state === "loading" ? "pending" : live ? "ok" : "missing"}
        label="Program"
      >
        <Clipped value={CC_TOKEN_PROGRAM_ADDRESS} />
        {!live && (
          <span className="text-muted">
            {deployed.state === "loading"
              ? "checking"
              : deployed.state === "failed"
                ? `could not reach ${CLUSTER.name}`
                : "not deployed yet"}
          </span>
        )}
      </Check>
      <WalletReadyGate
        client={client}
        fallback={
          <Check state="pending" label="Wallet">
            <span className="text-muted">checking</span>
          </Check>
        }
      >
        <Check state={connected ? "ok" : "missing"} label="Wallet">
          {connected ? (
            <Clipped value={connected.account.address} />
          ) : (
            <span className="text-muted">not connected</span>
          )}
        </Check>
      </WalletReadyGate>
    </ul>
  );

  if (ready && connected) {
    return (
      <div className="flex flex-col gap-4">
        {status}
        <LiveWorkspace
          key={connected.account.address}
          owner={connected.account.address as Address}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Use the deployed program</h1>
        <p className="mt-3 text-lg text-muted">
          Here the{" "}
          <a href={ROUTES.simulator} className="text-accent underline">
            simulator
          </a>
          's actions are real transactions on {CLUSTER.name}, signed by your wallet. It needs the
          program deployed and a connected wallet, set to {CLUSTER.name} and holding some{" "}
          {CLUSTER.name} SOL.
        </p>
      </section>
      {status}
      <Panel
        title="What will happen here"
        hint={
          live
            ? "Connect a wallet with the button at the top to start. Each action below maps to instructions of the deployed program."
            : `Nothing can be sent until the program is on ${CLUSTER.name}. Each action below maps to instructions the program already implements and tests locally.`
        }
      >
        <table className="w-full text-sm">
          <tbody>
            {ACTIONS.map((row) => (
              <tr key={row.action} className="border-t border-line first:border-t-0">
                <td className="py-2.5 pr-4 align-top">
                  <div className="font-medium">{row.action}</div>
                  <div className="text-muted">{row.detail}</div>
                </td>
                <td className="py-2.5 text-right align-top font-mono text-xs text-muted">
                  {row.instructions.split(", ").map((name) => (
                    <div key={name}>{name}</div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Check(props: { state: "ok" | "missing" | "pending"; label: string; children: ReactNode }) {
  const dot = props.state === "ok" ? "bg-good" : props.state === "missing" ? "bg-bad" : "bg-muted";
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <span className="text-muted">{props.label}</span>
      {props.children}
    </li>
  );
}

// An address shortened to its ends. The full value is in the tooltip and is copied on click.
function Clipped(props: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(props.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={`${props.value} (click to copy)`}
      className="font-mono hover:text-accent"
    >
      {copied ? "Copied" : `${props.value.slice(0, 4)}…${props.value.slice(-4)}`}
    </button>
  );
}
