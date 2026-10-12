import { useSyncExternalStore } from "react";

import { HowItWorks } from "./HowItWorks.tsx";
import { Live } from "./Live.tsx";
import { Presentation } from "./Presentation.tsx";
import { pitchSlideFromRoute, ROUTES } from "./routes.ts";
import { Simulator } from "./Simulator.tsx";
import { Toasts } from "./toast.tsx";
import { WalletBar } from "./Wallet.tsx";

function useHash(): string {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("hashchange", notify);
      return () => window.removeEventListener("hashchange", notify);
    },
    () => window.location.hash,
  );
}

export function App() {
  const hash = useHash();
  // The simulator is also the landing page.
  const requestedLive = hash === ROUTES.live || hash.startsWith(`${ROUTES.live}/`);
  const route = hash === ROUTES.docs || requestedLive ? hash : ROUTES.simulator;
  const live = requestedLive;

  // The talk takes the whole window, without the site header.
  const pitchSlide = pitchSlideFromRoute(hash);
  if (pitchSlide !== null) return <Presentation index={pitchSlide} />;

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-panel/90 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <a href={ROUTES.simulator} className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-md bg-accent font-mono text-sm font-bold text-panel">
              cc
            </span>
            <span className="font-semibold">cc-token</span>
          </a>
          <nav className="flex gap-1">
            <NavLink href={ROUTES.docs} active={route === ROUTES.docs}>
              How it works
            </NavLink>
            <NavLink href={ROUTES.simulator} active={route === ROUTES.simulator}>
              Simulator
            </NavLink>
            <NavLink href={ROUTES.live} active={live}>
              Live
            </NavLink>
          </nav>
          <div className="ml-auto">
            <WalletBar />
          </div>
        </div>
      </header>

      <main
        className={`mx-auto max-w-screen-2xl px-4 sm:px-6 ${route === ROUTES.simulator ? "py-4" : "py-8"}`}
      >
        {route === ROUTES.docs ? <HowItWorks /> : live ? <Live route={route} /> : <Simulator />}
      </main>
      <Toasts />
    </>
  );
}

function NavLink(props: { href: string; active: boolean; children: string }) {
  return (
    <a
      href={props.href}
      aria-current={props.active ? "page" : undefined}
      className={`rounded-md px-3 py-1 text-sm ${
        props.active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"
      }`}
    >
      {props.children}
    </a>
  );
}
