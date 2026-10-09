import { useSyncExternalStore } from "react";

export type Toast = Readonly<{
  id: number;
  tone: "pending" | "good" | "bad";
  text: string;
  links?: readonly Readonly<{ href: string; label: string }>[];
}>;

// How long a finished toast stays. A pending one stays until it is replaced.
const LIFETIME_MS = { good: 6_000, bad: 12_000 } as const;

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function publish(next: readonly Toast[]) {
  toasts = next;
  for (const listener of listeners) listener();
}

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  publish(toasts.filter((toast) => toast.id !== id));
}

// Shows a toast and returns its ID. Passing the ID of a toast still on screen replaces it in
// place, which is how "sending" turns into "sent" or "failed".
export function showToast(toast: Omit<Toast, "id">, replace?: number): number {
  const id = replace ?? nextId++;
  clearTimeout(timers.get(id));
  timers.delete(id);
  const entry = { ...toast, id };
  publish(
    toasts.some((existing) => existing.id === id)
      ? toasts.map((existing) => (existing.id === id ? entry : existing))
      : [...toasts, entry],
  );
  if (toast.tone !== "pending") {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), LIFETIME_MS[toast.tone]),
    );
  }
  return id;
}

export function Toasts() {
  const shown = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => toasts,
  );

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {shown.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === "bad" ? "alert" : "status"}
          className={`pointer-events-auto flex items-start gap-3 rounded-lg border bg-panel px-3 py-2.5 text-sm shadow-lg ${
            toast.tone === "good"
              ? "border-good"
              : toast.tone === "bad"
                ? "border-bad"
                : "border-accent"
          }`}
        >
          <span
            className={`mt-1.5 size-2 shrink-0 rounded-full ${
              toast.tone === "good"
                ? "bg-good"
                : toast.tone === "bad"
                  ? "bg-bad"
                  : "animate-pulse bg-accent"
            }`}
          />
          <div className="min-w-0 flex-1 break-words">
            {toast.text}
            {toast.links?.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="ml-2 text-accent underline"
              >
                {link.label}
              </a>
            ))}
          </div>
          {toast.tone !== "pending" && (
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 px-1 leading-none text-muted hover:text-ink"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
