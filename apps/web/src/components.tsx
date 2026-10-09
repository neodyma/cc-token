import { useState, type ReactNode } from "react";

export function Panel(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold tracking-wide uppercase">{props.title}</h2>
        {props.hint && <p className="mt-1 text-sm text-muted">{props.hint}</p>}
      </header>
      {props.children}
    </section>
  );
}

export function Chip(props: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        props.selected
          ? "border-accent bg-accent-soft text-accent"
          : "border-line text-ink hover:border-muted"
      }`}
    >
      {props.children}
    </button>
  );
}

export function Identifier(props: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(props.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div>
      <div className="text-sm text-muted">{props.label}</div>
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 truncate font-mono text-sm" title={props.value}>
          {props.value}
        </span>
        <button type="button" onClick={copy} className="shrink-0 text-sm text-accent underline">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export function Badge(props: { tone: "good" | "bad"; children: ReactNode }) {
  const tone = props.tone === "good" ? "bg-good-soft text-good" : "bg-bad-soft text-bad";
  return (
    <span className={`inline-block rounded-md px-2 py-1 text-sm font-medium ${tone}`}>
      {props.children}
    </span>
  );
}
