import { CC_TOKEN_PROGRAM_ADDRESS } from "@cc-token/sdk";
import { Fragment, useEffect, useState, type ReactNode } from "react";

import { liveScenarioRoute, pitchRoute, ROUTES } from "./routes.ts";
import { CLUSTER } from "./solana.ts";

// The five-minute talk, as slides inside the app so the demo is one click away. Each slide
// carries what is said over it, shown with the N key.
type Slide = Readonly<{ title: string; notes: string; compact?: boolean; body: ReactNode }>;

function Card(props: { tone?: "accent" | "plain"; compact?: boolean; children: ReactNode }) {
  return (
    <div
      className={`rounded-2xl border ${props.compact ? "p-4" : "p-6"} ${
        props.tone === "accent" ? "border-accent bg-accent-soft" : "border-line bg-panel"
      }`}
    >
      {props.children}
    </div>
  );
}

const DEMO_SCENARIO_ADDRESS = "6GUMH37oBtvRvKmAXDPLKEuXsWrToxGvtPpETyp21jWC";

function Bar(props: { percent: number; label: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="h-8 flex-1 overflow-hidden rounded-md bg-page">
        <div className="h-full rounded-md bg-accent" style={{ width: `${props.percent * 2}%` }} />
      </div>
      <span className="w-16 text-right font-mono text-3xl font-semibold">{props.percent}%</span>
      <span className="w-56 text-muted">{props.label}</span>
    </div>
  );
}

function Box(props: { label: string; featured?: boolean }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-center ${
        props.featured ? "border-accent bg-accent-soft" : "border-line bg-panel"
      }`}
    >
      <div className={props.featured ? "font-semibold text-accent" : "font-medium"}>
        {props.label}
      </div>
      <div className="mt-1 font-mono text-sm text-muted">100 shares</div>
    </div>
  );
}

const COMPARISON: readonly (readonly [string, string, string])[] = [
  ["“A and B”", "Two separate bets", "One asset"],
  ["Capital", "One stake per market", "One deposit for every combination"],
  ["If only A happens", "You still win half", "Pays nothing, as intended"],
  ["A range or group of results", "A new market each time", "Any group is one position"],
  ["Holding it elsewhere", "Tied to the venue", "A standard Token-2022 token"],
];

// Who does what, phase by phase. An empty cell means that actor has nothing to do then.
const ACTORS = ["Creator", "Holder", "Resolver"] as const;
const WORKFLOW: readonly Readonly<{ phase: string; cells: readonly (string | null)[] }>[] = [
  { phase: "Set up", cells: ["Publish scenario", null, "Prepare questions"] },
  { phase: "Issue", cells: ["Deposit → every piece", null, null] },
  { phase: "Distribute", cells: ["Keep bet, sell rest", "Receive or buy", null] },
  { phase: "Settle", cells: ["Redeem", "Redeem or sell", "Report results"] },
];

const SLIDES: readonly Slide[] = [
  {
    title: "cc-token",
    notes:
      "Most prediction markets let you buy “the Fed cuts” or “SOL is above two hundred dollars.” But there is no single asset for “the Fed cuts and SOL is above two hundred.” cc-token creates that joint claim on Solana from one collateral deposit.",
    body: (
      <div className="flex h-full flex-col justify-center">
        <div className="flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-xl bg-accent font-mono text-2xl font-bold text-panel">
            cc
          </span>
          <span className="text-3xl font-semibold">cc-token</span>
        </div>
        <h1 className="mt-10 text-7xl leading-tight font-semibold tracking-tight">
          One asset for <span className="text-accent">“A and B”</span>
        </h1>
        <p className="mt-6 text-3xl text-muted">Combinatorial conditional tokens on Solana</p>
      </div>
    ),
  },
  {
    title: "Two markets cannot tell you how two events are linked",
    notes:
      "Suppose separate markets imply fifty percent for a Fed cut and forty percent for SOL above two hundred. Those numbers do not price the combination. If the events were independent, it would be twenty percent. If they are correlated, it could be thirty-five. Buying both separate claims is different, because one can still pay when only one event occurs. The joint outcome needs its own position and price.",
    body: (
      <div className="flex flex-col gap-8">
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <div className="text-xl text-muted">Market 1</div>
            <div className="mt-2 text-3xl font-medium">The Fed cuts rates in December</div>
            <div className="mt-4 font-mono text-6xl font-semibold">50%</div>
          </Card>
          <Card>
            <div className="text-xl text-muted">Market 2</div>
            <div className="mt-2 text-3xl font-medium">SOL at $200 or more at year end</div>
            <div className="mt-4 font-mono text-6xl font-semibold">40%</div>
          </Card>
        </div>
        <Card tone="accent">
          <div className="text-3xl font-medium">Both?</div>
          <div className="mt-5 flex flex-col gap-3 text-xl">
            <Bar percent={20} label="if the two are unrelated" />
            <Bar percent={35} label="if a cut lifts SOL" />
          </div>
          <p className="mt-5 text-xl text-muted">The two markets look the same either way.</p>
        </Card>
        <p className="text-2xl text-muted">
          Today: two bets, twice the capital, and you are still paid when only one happens.
        </p>
      </div>
    ),
  },
  {
    title: "Deposit once. Hold every combination.",
    notes:
      "With cc-token, I deposit 100 tokens and split them by the Fed result. I then split each claim by the SOL result. That creates four outcome positions. The matching position pays after resolution, while the complete set stays backed by the original 100. Each position has one fixed ID, whatever order it is built in, and can be held in the program or wrapped as a Token-2022 token.",
    body: (
      <div className="flex flex-col items-center gap-3 text-xl">
        <div className="rounded-xl border border-line bg-panel px-8 py-3 text-center">
          <div className="font-medium">Deposit</div>
          <div className="mt-1 font-mono text-sm text-muted">100 tokens of collateral</div>
        </div>
        <div className="text-muted">split on “Does the Fed cut?”</div>
        <div className="grid w-full grid-cols-2 gap-6">
          <Box label="cut" />
          <Box label="no cut" />
        </div>
        <div className="text-muted">split each on “SOL at $200 or more?”</div>
        <div className="grid w-full grid-cols-4 gap-4">
          <Box label="cut and SOL ≥ $200" featured />
          <Box label="cut and SOL < $200" />
          <Box label="no cut and SOL ≥ $200" />
          <Box label="no cut and SOL < $200" />
        </div>
        <p className="mt-6 max-w-4xl text-center text-2xl text-muted">
          Exactly one of the four pays, so together they are always worth the 100 deposited. Each is
          an asset to hold, send, or wrap as an ordinary token.
        </p>
      </div>
    ),
  },
  {
    title: "Who does what",
    notes:
      "Three roles: a resolver prepares and reports each question, a creator deposits and keeps the pieces it believes in, holders receive or buy the rest, and the program holds the collateral with no admin.",
    body: (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[10rem_repeat(3,minmax(0,1fr))] gap-3 text-2xl">
          <div />
          {ACTORS.map((actor) => (
            <div key={actor} className="px-1 font-semibold text-accent">
              {actor}
            </div>
          ))}
          {WORKFLOW.map(({ phase, cells }) => (
            <Fragment key={phase}>
              <div className="self-center text-xl text-muted">{phase}</div>
              {cells.map((cell, index) =>
                cell === null ? (
                  <div
                    key={index}
                    className="rounded-xl border border-dashed border-line opacity-40"
                  />
                ) : (
                  <div
                    key={index}
                    className="rounded-xl border border-line bg-panel px-5 py-4 font-medium"
                  >
                    {cell}
                  </div>
                ),
              )}
            </Fragment>
          ))}
        </div>
        <div className="rounded-xl border border-accent bg-accent-soft px-5 py-4 text-center text-2xl font-medium">
          Program vault · no admin
        </div>
      </div>
    ),
  },
  {
    title: `Live on ${CLUSTER.name}`,
    notes:
      "This is the deployed program on devnet. I'll open a scenario read straight from the chain. [Open the prepared scenario.] The scenario defines the featured position: the Fed cuts and SOL finishes at or above two hundred dollars. The graph rebuilds both questions from their on-chain definitions. [Enter the amount and click Get this position.] The first confirmed split creates the Fed outcomes. The second refines the cut outcome into the two SOL outcomes. I now hold the joint position I selected, while the complementary positions remain in my graph and keep the deposit fully backed. [If time and devnet permit: select the featured box, open Wrap / Unwrap and wrap one share.] Wrapping escrows one share and mints one Token-2022 token for this position. Existing wallets and exchanges can hold it without knowing anything about cc-token. It can be unwrapped back into shares at any time, to merge or redeem.",
    body: (
      <div className="grid grid-cols-[1fr_auto] items-center gap-12">
        <ol className="flex flex-col gap-5 text-2xl">
          {[
            ["Find it", "Scenarios are published on-chain and listed for every wallet."],
            ["Get the position", "Deposit 100, one click, one transaction per question."],
            ["See it", "The graph shows the deposit and every piece it became."],
            ["Wrap it", "It appears in the wallet as an ordinary token, named on-chain."],
            ["Redeem it", "When the results are in, it pays out in the collateral."],
          ].map(([step, detail], index) => (
            <li key={step} className="flex gap-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent font-mono text-lg font-semibold text-panel">
                {index + 1}
              </span>
              <span>
                <span className="font-semibold">{step}.</span>{" "}
                <span className="text-muted">{detail}</span>
              </span>
            </li>
          ))}
        </ol>
        <a
          href={liveScenarioRoute(DEMO_SCENARIO_ADDRESS)}
          target="_blank"
          rel="noreferrer"
          className="rounded-2xl bg-accent px-10 py-6 text-3xl font-semibold text-panel shadow-lg"
        >
          Open the demo →
        </a>
      </div>
    ),
  },
  {
    title: "How it compares",
    notes:
      "Compared with isolated markets, cc-token makes “A and B” one asset backed by one deposit. Multi-outcome questions and grouped ranges use the same primitive. The model comes from Gnosis conditional tokens on Ethereum; we bring combined positions to Solana as standard tokens. The protocol provides the conditional asset layer; a market maker can price and trade those assets above it.",
    body: (
      <div className="flex flex-col gap-8">
        <table className="w-full text-left text-2xl">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-4 font-medium" />
              <th className="py-2 pr-4 font-medium">Separate markets</th>
              <th className="py-2 font-medium text-accent">cc-token</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map(([what, separate, combined]) => (
              <tr key={what} className="border-b border-line last:border-0">
                <td className="py-4 pr-4 text-muted">{what}</td>
                <td className="py-4 pr-4">{separate}</td>
                <td className="py-4 font-medium">{combined}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  {
    title: "What is real, and what is next",
    notes:
      "The Anchor program, TypeScript SDK and web application are deployed and tested on devnet. The next layer is exchange liquidity for the wrapped positions. cc-token gives Solana a general, fully backed representation for claims on combinations of outcomes.",
    body: (
      <div className="grid grid-cols-2 gap-8 text-2xl">
        <Card>
          <div className="text-xl text-muted">Today</div>
          <ul className="mt-4 flex flex-col gap-4">
            <li>
              <span className="font-semibold">Program</span> deployed on {CLUSTER.name}
              <div className="mt-1 font-mono text-sm break-all text-muted">
                {CC_TOKEN_PROGRAM_ADDRESS}
              </div>
            </li>
            <li>
              <span className="font-semibold">TypeScript SDK</span> for building and verifying
              positions
            </li>
            <li>
              <span className="font-semibold">This app</span>: a simulator and the live page
            </li>
            <li>
              <span className="font-semibold">Tested</span> on a local validator and on{" "}
              {CLUSTER.name}
            </li>
          </ul>
        </Card>
        <Card tone="accent">
          <div className="text-xl text-muted">Next</div>
          <p className="mt-4 text-3xl leading-snug font-medium">
            A market for wrapped positions, so the price of “both happen” can be read off a chart.
          </p>
          <p className="mt-6 text-xl text-muted">
            There is no market yet: cc-token is the asset layer that one would trade.
          </p>
          <p className="mt-6 text-xl text-muted">
            Also in the program: results shared by weight, and curved payouts.
          </p>
        </Card>
      </div>
    ),
  },
  // Kept after the close, for questions: the talk itself ends on the slide before.
  {
    title: "Backup: results can be shared, not only won or lost",
    notes:
      "Results don't have to be all or nothing: the resolver can report weights. Take one question, where SOL settles between $100 and $300, with two results, high and low. If it settles at $250, three quarters of the way up, the resolver reports 75 for high and 25 for low. A hundred shares of high pay 75, a hundred of low pay 25: still exactly the 100 deposited. That's a payout that tracks a price, from the same instructions, and it combines like any question: “the Fed cuts, and high” pays 75 only if the Fed cut.",
    body: (
      <div className="flex flex-col gap-8">
        <Card>
          <div className="text-xl text-muted">One question, two results: high and low</div>
          <div className="mt-2 text-3xl font-medium">
            Where does SOL settle between $100 and $300?
          </div>
          <div className="relative mt-8 h-4 rounded-full bg-page">
            <div className="h-full w-3/4 rounded-full bg-accent" />
            <div className="absolute -top-2 left-3/4 h-8 w-1 -translate-x-1/2 rounded bg-ink" />
          </div>
          <div className="mt-3 flex justify-between font-mono text-lg text-muted">
            <span>$100</span>
            <span className="font-semibold text-ink">settles at $250</span>
            <span>$300</span>
          </div>
        </Card>
        <div className="grid grid-cols-3 gap-5 text-xl">
          <Card tone="accent">
            <div className="text-muted">100 shares of “high”</div>
            <div className="mt-2 font-mono text-5xl font-semibold">75</div>
            <div className="mt-1 text-muted">weight 75 of 100</div>
          </Card>
          <Card>
            <div className="text-muted">100 shares of “low”</div>
            <div className="mt-2 font-mono text-5xl font-semibold">25</div>
            <div className="mt-1 text-muted">weight 25 of 100</div>
          </Card>
          <Card>
            <div className="text-muted">Together</div>
            <div className="mt-2 font-mono text-5xl font-semibold">100</div>
            <div className="mt-1 text-muted">exactly the deposit</div>
          </Card>
        </div>
        <p className="text-2xl text-muted">
          A payout that follows a price, from the same instructions. It combines like any other
          question: “the Fed cuts, and high” pays 75 only if the Fed cut.
        </p>
      </div>
    ),
  },
  {
    title: "Backup: ask the same question twice for a curved payout",
    compact: true,
    notes:
      "With weights, you can ask the same question twice on purpose. Say an RPC provider posts a bond against downtime, and the question is what share of the month the service was down. If it was down a quarter of the month, “down” gets 25 and “up” gets 75. A hundred shares of “down” pay 25; a hundred of “down and down” pay 25% of 25%, so 6.25. The payout is the square of the downtime: small outages cost almost nothing, big ones cost a lot. “Down and up” is the same position as “up and down”, so the four split paths give three positions: its 200 shares pay 37.5, and the three still pay the 100 deposited. Repeating the question again gives higher powers.",
    body: (
      <div className="flex flex-col gap-4">
        <Card compact>
          <div className="text-xl text-muted">An uptime bond: one question, used twice</div>
          <div className="mt-2 text-3xl font-medium">
            What share of the month was the service down?
          </div>
          <p className="mt-3 text-xl text-muted">
            Down a quarter of the month: the resolver reports 25 to “down” and 75 to “up”.
          </p>
        </Card>
        <div className="grid grid-cols-3 gap-4 text-lg">
          {(
            [
              ["down × down", "100 shares", "6.25", "25% × 25%", true],
              ["down × up", "200 shares", "37.5", "same ID as up × down · 2 × 25% × 75%", false],
              ["up × up", "100 shares", "56.25", "75% × 75%", false],
            ] as const
          ).map(([name, shares, pays, why, featured]) => (
            <Card key={name} tone={featured ? "accent" : "plain"} compact>
              <div className="text-muted">
                {shares} of “{name}”
              </div>
              <div className="mt-2 font-mono text-4xl font-semibold">{pays}</div>
              <div className="mt-1 text-muted">total payout · {why}</div>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-[auto_1fr] items-center gap-6">
          <table className="text-left font-mono text-xl">
            <thead className="text-muted">
              <tr className="border-b border-line">
                <th className="py-1.5 pr-8 font-medium">Downtime</th>
                <th className="py-1.5 font-medium">“down × down” pays</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["10%", "1%"],
                ["25%", "6.25%"],
                ["50%", "25%"],
                ["100%", "100%"],
              ].map(([down, pays]) => (
                <tr key={down} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-8">{down}</td>
                  <td className="py-1.5">{pays}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-2xl text-muted">
            The payout is the square of the downtime: small outages cost little, large ones cost a
            lot. Four split paths collapse into three balances, which still pay the 100 deposited.
          </p>
        </div>
      </div>
    ),
  },
  {
    title: "Backup: how it works",
    notes:
      "Each position's ID comes from its questions and results, and it's the same whatever order you build it in. Collateral sits in a vault and only leaves through a full-set merge or a redemption. And any group of results on a question is one position, so a price range needs no new oracle question.",
    body: (
      <div className="flex flex-col gap-8">
        <div className="grid grid-cols-3 gap-5 text-xl">
          <Card>
            <div className="font-semibold">One identity per position</div>
            <p className="mt-2 text-muted">
              Derived from its questions and results. The same in whatever order it is built.
            </p>
          </Card>
          <Card>
            <div className="font-semibold">Fully backed</div>
            <p className="mt-2 text-muted">
              Collateral sits in a vault and leaves only by merging a full set or redeeming a
              result.
            </p>
          </Card>
          <Card>
            <div className="font-semibold">Any group of results</div>
            <p className="mt-2 text-muted">
              A price range is one position. No new oracle question is needed for it.
            </p>
          </Card>
        </div>
      </div>
    ),
  },
];

export function Presentation(props: { index: number }) {
  const index = Math.min(Math.max(props.index, 0), SLIDES.length - 1);
  const slide = SLIDES[index]!;
  const [notes, setNotes] = useState(false);

  useEffect(() => {
    const go = (next: number) => {
      if (next >= 0 && next < SLIDES.length) window.location.hash = pitchRoute(next);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        go(index + 1);
      } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        go(index - 1);
      } else if (event.key === "n" || event.key === "N") {
        setNotes((shown) => !shown);
      } else if (event.key === "Escape") {
        window.location.hash = ROUTES.simulator;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index]);

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-page text-ink">
      <main
        className={`mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center overflow-y-auto px-10 ${slide.compact ? "py-4" : "py-8"}`}
      >
        {index > 0 && (
          <h2
            className={`${slide.compact ? "mb-6 text-4xl" : "mb-10 text-5xl"} leading-tight font-semibold tracking-tight`}
          >
            {slide.title}
          </h2>
        )}
        {slide.body}
      </main>

      {notes && (
        <aside className="border-t border-line bg-panel px-10 py-4">
          <p className="mx-auto max-w-6xl text-lg leading-relaxed text-muted">{slide.notes}</p>
        </aside>
      )}

      <footer className="flex items-center gap-4 border-t border-line px-6 py-2 text-sm text-muted">
        <a href={ROUTES.simulator} className="hover:text-ink">
          Esc · exit
        </a>
        <button
          type="button"
          onClick={() => setNotes((shown) => !shown)}
          className="hover:text-ink"
        >
          N · {notes ? "hide" : "show"} notes
        </button>
        <span className="ml-auto flex items-center gap-3">
          <a
            href={pitchRoute(Math.max(index - 1, 0))}
            aria-label="Previous slide"
            className={index === 0 ? "pointer-events-none opacity-30" : "hover:text-ink"}
          >
            ←
          </a>
          <span className="font-mono">
            {index + 1} / {SLIDES.length}
          </span>
          <a
            href={pitchRoute(Math.min(index + 1, SLIDES.length - 1))}
            aria-label="Next slide"
            className={
              index === SLIDES.length - 1 ? "pointer-events-none opacity-30" : "hover:text-ink"
            }
          >
            →
          </a>
        </span>
      </footer>
    </div>
  );
}
