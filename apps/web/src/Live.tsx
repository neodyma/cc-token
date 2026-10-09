import { CC_TOKEN_PROGRAM_ADDRESS } from "@cc-token/sdk";
import { useConnectedWallet, WalletReadyGate } from "@solana/kit-plugin-wallet/react";
import type { ReactNode } from "react";

import { Identifier, Panel } from "./components.tsx";
import { ROUTES } from "./routes.ts";
import { client, CLUSTER } from "./solana.ts";
import { useProgramDeployed } from "./Wallet.tsx";

// What the simulator does in the browser, next to the program instructions that do it on-chain.
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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Use the deployed program</h1>
        <p className="mt-3 text-lg text-muted">
          This page is where the{" "}
          <a href={ROUTES.simulator} className="text-accent underline">
            simulator
          </a>
          's actions become real transactions on {CLUSTER.name}, signed by your wallet. It checks
          what is needed first.
        </p>
      </section>

      <Panel title="Status">
        <ul className="flex flex-col gap-4">
          <Check state="ok" title={`Network: ${CLUSTER.name}`}>
            A test network. Its tokens have no value.
          </Check>
          <Check
            state={deployed.state === "loading" ? "pending" : live ? "ok" : "missing"}
            title={
              deployed.state === "loading"
                ? "Program: checking"
                : deployed.state === "failed"
                  ? `Program: could not reach ${CLUSTER.name}`
                  : live
                    ? "Program: deployed"
                    : "Program: not deployed yet"
            }
          >
            <Identifier label="Program address" value={CC_TOKEN_PROGRAM_ADDRESS} />
          </Check>
          <WalletReadyGate
            client={client}
            fallback={
              <Check state="pending" title="Wallet: checking">
                Looking for installed wallets.
              </Check>
            }
          >
            <WalletCheck />
          </WalletReadyGate>
        </ul>
      </Panel>

      <Panel
        title="What will happen here"
        hint={
          live
            ? "The program is deployed, but this page does not send transactions yet. Each action below maps to instructions the program already implements."
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

function WalletCheck() {
  const connected = useConnectedWallet(client);
  return connected ? (
    <Check state="ok" title="Wallet: connected">
      <span className="font-mono break-all">{connected.account.address}</span>
    </Check>
  ) : (
    <Check state="missing" title="Wallet: not connected">
      Use the Connect wallet button at the top, with the wallet set to {CLUSTER.name}.
    </Check>
  );
}

function Check(props: { state: "ok" | "missing" | "pending"; title: string; children: ReactNode }) {
  const dot = props.state === "ok" ? "bg-good" : props.state === "missing" ? "bg-bad" : "bg-muted";
  return (
    <li className="flex gap-3">
      <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{props.title}</div>
        <div className="text-sm text-muted">{props.children}</div>
      </div>
    </li>
  );
}
