import { CC_TOKEN_PROGRAM_ADDRESS } from "@cc-token/sdk";
import type { Address } from "@solana/kit";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  useWalletStatus,
  WalletReadyGate,
} from "@solana/kit-plugin-wallet/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "./components.tsx";
import { client, CLUSTER } from "./solana.ts";

const LAMPORTS_PER_SOL = 1_000_000_000n;

const WALLET_LINKS = [
  { name: "Phantom", url: "https://phantom.com/download" },
  { name: "Solflare", url: "https://solflare.com/download" },
  { name: "Backpack", url: "https://backpack.app/download" },
] as const;

type Loaded<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed" };

function useLoaded<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [result, setResult] = useState<Loaded<T>>({ state: "loading" });
  useEffect(() => {
    let current = true;
    setResult({ state: "loading" });
    load().then(
      (value) => current && setResult({ state: "ready", value }),
      () => current && setResult({ state: "failed" }),
    );
    return () => {
      current = false;
    };
  }, [key]);
  return result;
}

function formatSol(lamports: bigint): string {
  const fraction = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0").slice(0, 4);
  return `${lamports / LAMPORTS_PER_SOL}.${fraction} SOL`;
}

function shorten(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletBar() {
  return (
    <div className="flex items-center gap-2">
      <ProgramStatus />
      <WalletReadyGate
        client={client}
        fallback={<WalletButton disabled>Connect wallet</WalletButton>}
      >
        <WalletMenu />
      </WalletReadyGate>
    </div>
  );
}

function WalletButton(props: { disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-panel disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}

function WalletMenu() {
  const dialog = useRef<HTMLDialogElement>(null);
  const connected = useConnectedWallet(client);
  const close = () => dialog.current?.close();

  return (
    <>
      <WalletButton onClick={() => dialog.current?.showModal()}>
        {connected ? (
          <>
            <img src={connected.wallet.icon} alt="" className="size-4 rounded-sm" />
            <span className="font-mono">{shorten(connected.account.address)}</span>
          </>
        ) : (
          "Connect wallet"
        )}
      </WalletButton>
      <dialog
        ref={dialog}
        onClick={(event) => event.target === dialog.current && close()}
        className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-0 text-ink backdrop:bg-black/50"
      >
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{connected ? "Wallet" : "Connect a wallet"}</h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="rounded-md px-2 text-xl leading-none text-muted hover:text-ink"
            >
              ×
            </button>
          </div>
          {connected ? (
            <AccountDetails address={connected.account.address as Address} onDone={close} />
          ) : (
            <WalletList onConnected={close} />
          )}
        </div>
      </dialog>
    </>
  );
}

function WalletList(props: { onConnected: () => void }) {
  const wallets = useWallets(client);
  const status = useWalletStatus(client);
  const connect = useConnect(client);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(wallet: (typeof wallets)[number]) {
    setPending(wallet.name);
    setFailed(false);
    try {
      await connect.dispatchAsync(wallet);
      props.onConnected();
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  if (wallets.length === 0) {
    return (
      <div className="text-sm text-muted">
        <p>No Solana wallet was found in this browser. Install one, then reload this page.</p>
        <ul className="mt-3 flex flex-col gap-1">
          {WALLET_LINKS.map((link) => (
            <li key={link.name}>
              <a href={link.url} target="_blank" rel="noreferrer" className="text-accent underline">
                {link.name}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      <ul className="flex flex-col gap-2">
        {wallets.map((wallet) => (
          <li key={wallet.name}>
            <button
              type="button"
              disabled={status === "connecting"}
              onClick={() => choose(wallet)}
              className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left hover:border-muted disabled:opacity-50"
            >
              <img src={wallet.icon} alt="" className="size-7 rounded-md" />
              <span className="font-medium">{wallet.name}</span>
              <span className="ml-auto text-sm text-muted">
                {pending === wallet.name ? "Approve in wallet…" : "Detected"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {failed && <p className="mt-3 text-sm text-bad">Connection was not completed. Try again.</p>}
      <p className="mt-4 text-sm text-muted">
        This demo uses {CLUSTER.name}. Switch your wallet to {CLUSTER.name} before signing.
      </p>
    </div>
  );
}

function AccountDetails(props: { address: Address; onDone: () => void }) {
  const disconnect = useDisconnect(client);
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(props.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-sm text-muted">Address</div>
        <div className="font-mono text-sm break-all">{props.address}</div>
      </div>
      <div>
        <div className="text-sm text-muted">Balance on {CLUSTER.name}</div>
        <Balance address={props.address} />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="flex-1 rounded-md border border-line px-3 py-1.5 text-sm hover:border-muted"
        >
          {copied ? "Copied" : "Copy address"}
        </button>
        <button
          type="button"
          onClick={() => {
            disconnect.dispatch();
            props.onDone();
          }}
          className="flex-1 rounded-md border border-line px-3 py-1.5 text-sm text-bad hover:border-bad"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

function Balance(props: { address: Address }) {
  const balance = useLoaded(
    async () => (await client.rpc.getBalance(props.address).send()).value,
    props.address,
  );
  if (balance.state === "loading") return <div className="text-sm text-muted">Loading…</div>;
  if (balance.state === "failed") return <div className="text-sm text-muted">Unavailable</div>;
  return <div className="font-mono text-sm">{formatSol(balance.value)}</div>;
}

function ProgramStatus() {
  const deployed = useLoaded(
    async () =>
      (
        await client.rpc
          .getAccountInfo(CC_TOKEN_PROGRAM_ADDRESS, {
            encoding: "base64",
            dataSlice: { offset: 0, length: 0 },
          })
          .send()
      ).value !== null,
    CC_TOKEN_PROGRAM_ADDRESS,
  );
  const status =
    deployed.state === "loading"
      ? { dot: "bg-muted", text: "checking", detail: `Checking ${CLUSTER.name} for the program.` }
      : deployed.state === "failed"
        ? { dot: "bg-bad", text: "unreachable", detail: `Could not reach ${CLUSTER.name}.` }
        : deployed.value
          ? { dot: "bg-good", text: "live", detail: `The program is deployed on ${CLUSTER.name}.` }
          : {
              dot: "bg-muted",
              text: "preview",
              detail: `The program is not on ${CLUSTER.name} yet, so a connected wallet is not used.`,
            };
  return (
    <span
      title={status.detail}
      className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-sm text-muted"
    >
      <span className={`size-2 rounded-full ${status.dot}`} />
      {CLUSTER.name} · {status.text}
    </span>
  );
}
