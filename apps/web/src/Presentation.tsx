import { CC_TOKEN_PROGRAM_ADDRESS } from "@cc-token/sdk";
import { useEffect, useState, type ReactNode } from "react";

import { pitchRoute, ROUTES } from "./routes.ts";
import { CLUSTER } from "./solana.ts";

// The five-minute talk, as slides inside the app so the demo is one click away. Each slide
// carries what is said over it, shown with the N key.
type Slide = Readonly<{ title: string; notes: string; body: ReactNode }>;

function Card(props: { tone?: "accent" | "plain"; children: ReactNode }) {
  return (
    <div
      className={`rounded-2xl border p-6 ${
        props.tone === "accent" ? "border-accent bg-accent-soft" : "border-line bg-panel"
      }`}
    >
      {props.children}
    </div>
  );
}

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

const SLIDES: readonly Slide[] = [
  {
    title: "cc-token",
    notes:
      "We are building cc-token: combinatorial conditional tokens on Solana. In five minutes: the problem, what it is, a live demo, and how it compares.",
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
      "Two prediction markets. One says the Fed has a 50% chance of cutting rates. The other says SOL has a 40% chance of finishing above $200. A question neither can answer: if the Fed cuts, does SOL go up? The chance of both could be 20% or 35%, and those two markets look exactly the same either way. Today you cannot buy “both happen” as one asset. You buy two separate bets, tie up twice the capital, and still get paid when only one comes true.",
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
      "cc-token is a Solana program for combinatorial conditional tokens. You deposit collateral once and split it across questions. Deposit 100, split on the Fed, split again on SOL, and you hold four positions, one per combination. Exactly one of them will pay out, so together they are always worth your 100. Each one is an asset you can hold, send, or wrap as an ordinary token. And now “Fed cuts and SOL above $200” has its own price.",
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
    title: `Live on ${CLUSTER.name}`,
    notes:
      "This is the program live on devnet. Scenarios are published on-chain, so anyone can find them. I open “Fed cut and SOL above $200”. The page tells me what the position pays on. I deposit 100 and click once. Two transactions, one per question. The graph shows what happened: my deposit became “cut” and “no cut”, and “cut” became “SOL above 200” and “SOL below 200”. I hold the one I wanted, and the others are still mine to send or sell. Now I wrap it. It is in my wallet as a normal token, with a name the program wrote on-chain. Any wallet or exchange on Solana can hold it without knowing anything about us. Someone who receives it opens our app and sees which questions it belongs to. And when the results are in, they redeem it for the collateral.",
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
          href={ROUTES.live}
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
      "With separate markets, “A and B” is two bets and two stakes, and you are still paid when only one happens. Here it is one asset from one deposit, and it pays nothing unless both happen. A question can have many results, and any group of them is one position, so a price range needs no new market. The idea comes from Gnosis’ conditional tokens on Ethereum, which Polymarket is built on, although its markets each cover a single question. We bring the combined positions to Solana and make each one a standard token.",
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
      "Everything you saw is deployed: the program, a TypeScript SDK, and this app, tested end to end on a local validator and on devnet. What we do not have is a market. We are the asset layer; the next step is an exchange for wrapped positions, so the price of “both happen” is something you can read off a chart.",
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
      "A result does not have to be all or nothing. The resolver reports weights. Take one question: where does SOL settle between $100 and $300? It has two results, high and low. If SOL settles at $250, three quarters of the way up, the resolver reports 75 to high and 25 to low. A hundred shares of high pay 75, a hundred of low pay 25, and together they still pay exactly the 100 that was deposited. That is a payout that follows a price, built from the same two instructions. And it combines like any other question: “the Fed cuts, and high” pays 75 only if the Fed cut.",
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
    notes:
      "Once results are weights, a question can be used twice on purpose. Take an RPC provider that posts a bond against downtime. One question: what share of the month was the service down? If it was down a quarter of the month, “down” gets weight 25 and “up” gets 75. A position on “down” pays 25. A position on “down and down”, the same question applied twice, pays 25% of 25%, which is 6.25. So the payout is the square of the downtime: small outages cost almost nothing, large ones cost a lot. The four pieces still add up to the 100 deposited, so it is fully backed like everything else. The same construction gives any payout that is a power of a reported fraction.",
    body: (
      <div className="flex flex-col gap-8">
        <Card>
          <div className="text-xl text-muted">An uptime bond: one question, used twice</div>
          <div className="mt-2 text-3xl font-medium">
            What share of the month was the service down?
          </div>
          <p className="mt-3 text-xl text-muted">
            Down a quarter of the month: the resolver reports 25 to “down” and 75 to “up”.
          </p>
        </Card>
        <div className="grid grid-cols-4 gap-4 text-lg">
          {[
            ["down × down", "6.25", "25% of 25%", true],
            ["down × up", "18.75", "25% of 75%", false],
            ["up × down", "18.75", "75% of 25%", false],
            ["up × up", "56.25", "75% of 75%", false],
          ].map(([name, pays, why, featured]) => (
            <Card key={name as string} tone={featured ? "accent" : "plain"}>
              <div className="text-muted">100 shares of “{name}”</div>
              <div className="mt-2 font-mono text-4xl font-semibold">{pays}</div>
              <div className="mt-1 text-muted">{why}</div>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-[auto_1fr] items-center gap-8">
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
            lot. The four pieces still add up to the 100 deposited.
          </p>
        </div>
      </div>
    ),
  },
  {
    title: "Backup: how it works",
    notes:
      "Every position has an identifier derived from its questions and results, and it is the same in whatever order you build it. Collateral sits in a vault and can only leave by merging a full set or redeeming a result. A question can have many results, and any group of them is one position, so a price range needs no new oracle question.",
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
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center overflow-y-auto px-10 py-8">
        {index > 0 && (
          <h2 className="mb-10 text-5xl leading-tight font-semibold tracking-tight">
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
