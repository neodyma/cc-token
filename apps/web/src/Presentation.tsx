import { CC_TOKEN_PROGRAM_ADDRESS } from "@cc-token/sdk";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { liveScenarioRoute, pitchRoute, presenterRoute, ROUTES } from "./routes.ts";
import turbin3Logo from "./assets/turbin3-logo.svg?raw";
import { CLUSTER } from "./solana.ts";

// The five-minute talk, as slides inside the app so the demo is one click away. Each slide
// carries what is said over it, shown in a separate presenter window (N key).
type Slide = Readonly<{
  title: string;
  notes: string;
  compact?: boolean;
  // The notes window then follows the demo video step by step.
  demo?: boolean;
  // Said after the demo video, below its steps in the notes window.
  after?: string;
  body: ReactNode;
}>;

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

// A question, the same way wherever it appears: an accent pill with its number. With a lead-in
// it is one split step of a diagram.
function Question(props: { number?: number; split?: string; text: string }) {
  const pill = (
    <span className="inline-flex items-center gap-2.5 rounded-3xl border border-accent bg-accent-soft py-1.5 pr-5 pl-1.5">
      <QuestionTag number={props.number} />
      <span className="font-semibold text-ink">{props.text}</span>
    </span>
  );
  if (!props.split) return pill;
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted">{props.split}</span>
      {pill}
    </div>
  );
}

function QuestionTag(props: { number?: number | undefined }) {
  return (
    <span className="rounded-full bg-accent px-2.5 py-0.5 font-mono text-sm font-semibold text-panel">
      Q{props.number ?? ""}
    </span>
  );
}

function Box(props: { label: string; featured?: boolean }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-center ${
        props.featured ? "border-accent bg-accent-soft" : "border-line bg-panel"
      }`}
    >
      {/* A combined label breaks after “&”, so each condition keeps its own line. */}
      <div
        className={`whitespace-pre-line ${props.featured ? "font-semibold text-accent" : "font-medium"}`}
      >
        {props.label.replace(" & ", " &\n")}
      </div>
      <div className="mt-1 font-mono text-sm text-muted">100 shares</div>
    </div>
  );
}

// "Yes" and "No" cells render as a green check and a red cross.
function ComparisonCell(props: Readonly<{ value: string }>) {
  if (props.value === "Yes") {
    return (
      <span className="font-semibold text-good" aria-label="Yes">
        ✓
      </span>
    );
  }
  if (props.value === "No") {
    return (
      <span className="font-semibold text-bad" aria-label="No">
        ✗
      </span>
    );
  }
  return <>{props.value}</>;
}

const COMPARISON: readonly (readonly [string, string, string, string])[] = [
  ["What can be combined", "Nothing", "What the platform lists", "Any questions, any results"],
  [
    "Outcomes covered",
    "2 per market",
    "Up to 50 binary legs",
    "256ⁿ: n questions, up to 256 results each",
  ],
  ["Who creates it", "—", "The platform's market makers", "Anyone, from one deposit"],
  ["If only A happens", "One bet still pays", "Pays nothing", "Pays nothing"],
  ["Results by share", "No", "No", "Yes"],
  ["Where it lives", "On the platform", "On the platform", "A token in any wallet"],
];

// What the demo video shows, the second each step starts at, and what to say over it.
type DemoStep = Readonly<{
  step: string;
  detail: string;
  start: number;
  say: string;
  // Not needed to settle a position: only to trade it as a token.
  optional?: boolean;
}>;
const DEMO_STEPS: readonly DemoStep[] = [
  {
    step: "Create",
    detail: "Two questions, one featured combination",
    start: 0,
    say: "Alice creates a scenario: / two questions, the Fed and the SOL price, / and the combination it features.",
  },
  {
    step: "Take",
    detail: "Deposit 100, one split per question",
    start: 8.8,
    say: "She deposits a hundred and splits once per question. / Together, the pieces are always worth the scenario's collateral.",
  },
  {
    step: "Send",
    detail: "25 shares to Bob, no setup needed",
    start: 18.3,
    say: "She sends twenty-five shares to Bob, / who needs no setup.",
  },
  {
    step: "Receive",
    detail: "Found from its address alone",
    start: 25.2,
    say: "Bob finds them from his address alone, / question wording included.",
  },
  {
    step: "Wrap",
    detail: "A Token-2022 token, for markets",
    start: 31.7,
    say: "Optionally, / wrapping turns shares into an ordinary token, / so markets and wallets can trade it.",
    optional: true,
  },
  {
    step: "Resolve",
    detail: "Only the resolver reports, once",
    start: 38.2,
    say: "The resolver reports both results. / No one else can, / and once reported, it can't be changed.",
  },
  {
    step: "Unwrap",
    detail: "Back to shares, to redeem",
    start: 49.2,
    say: "Alice can unwrap the tokens she wrapped earlier / back into shares, / to be able to redeem.",
    optional: true,
  },
  {
    step: "Redeem all",
    detail: "75 winning shares pay 75",
    start: 56.8,
    say: "Redeem all turns seventy-five winning shares / into seventy-five collateral tokens.",
  },
];

const demoStepAt = (time: number) =>
  DEMO_STEPS.reduce((found, { start }, index) => (time >= start ? index : found), -1);

const DEMO_VIDEO = `${import.meta.env.BASE_URL}pitch/demo.mp4`;

function OptionalTag() {
  return (
    <span className="rounded-full border border-dashed border-muted px-2 py-px text-xs font-medium text-muted">
      optional
    </span>
  );
}

// Just before a step's end, so a paused video still shows that step, not the next title card.
const STEP_EDGE = 0.08;

// The step cards follow the video while it plays, and clicking one plays it. By default the
// video pauses after each step, and the next-slide keys play the following step until the
// last one has played.
function Demo() {
  const video = useRef<HTMLVideoElement>(null);
  const [missing, setMissing] = useState(false);
  const [time, setTime] = useState(0);
  // The video fills the window when the browser refuses real full screen.
  const [expanded, setExpanded] = useState(false);
  const [stepwise, setStepwise] = useState(true);
  const current = demoStepAt(time);

  const finished = () => {
    const player = video.current;
    return !player || player.ended || player.currentTime >= player.duration - 0.2;
  };
  const playStep = (index: number) => {
    const player = video.current;
    const step = DEMO_STEPS[index];
    if (!player || !step) return;
    player.currentTime = step.start;
    player.play().catch(() => {});
  };
  // The next step, from a pause at the end of the last one. False once the video is over.
  const advance = () => {
    const player = video.current;
    if (!player || finished()) return false;
    if (player.paused) player.play().catch(() => {});
    else player.pause();
    return true;
  };

  // Pauses when playback crosses the end of a step. Starting from a pause at a step's end, or
  // seeking past one, is not a crossing. Checked on every frame, and on the video's own time
  // updates, which keep coming when the window is in the background and frames stop.
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    let frame = 0;
    let last = player.currentTime;
    // Where playback last started or jumped to. A video paused at a step's end reports its
    // time rounded, a hair before that end, so playing on from there is not a crossing.
    let origin = last;
    const ends = DEMO_STEPS.slice(1).map(({ start }) => start - STEP_EDGE);
    const check = () => {
      const now = player.currentTime;
      const crossed = ends.find((end) => last < end && end <= now && origin < end - 0.02);
      if (stepwise && !player.paused && crossed !== undefined) {
        player.pause();
        player.currentTime = crossed;
        last = origin = crossed;
      } else {
        last = now;
      }
    };
    const onFrame = () => {
      check();
      frame = requestAnimationFrame(onFrame);
    };
    const onSeek = () => {
      last = origin = player.currentTime;
    };
    player.addEventListener("seeking", onSeek);
    player.addEventListener("timeupdate", check);
    frame = requestAnimationFrame(onFrame);
    return () => {
      player.removeEventListener("seeking", onSeek);
      player.removeEventListener("timeupdate", check);
      cancelAnimationFrame(frame);
    };
  }, [missing, stepwise]);

  const toggleFullScreen = () => {
    const player = video.current;
    if (!player) return;
    if (document.fullscreenElement) return void document.exitFullscreen();
    if (expanded) return setExpanded(false);
    player.requestFullscreen().catch(() => setExpanded(true));
  };

  // Listeners are set up once and read the current state from here.
  const latest = useRef({ expanded, stepwise, advance, playStep, toggleFullScreen, finished });
  latest.current = { expanded, stepwise, advance, playStep, toggleFullScreen, finished };

  // The notes window asks through the window that opened it, handing over its click so the
  // browser allows full screen. Escape leaves the filled window before it would leave the deck,
  // and the next-slide keys play the next step while there is one.
  useEffect(() => {
    const onMessage = (event: MessageEvent<{ video?: unknown }>) => {
      if (event.origin === window.location.origin && event.data.video === "fullscreen") {
        latest.current.toggleFullScreen();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const { expanded, stepwise, advance } = latest.current;
      if (event.key === "Escape" && expanded) {
        event.stopImmediatePropagation();
        setExpanded(false);
      } else if (stepwise && ["ArrowRight", "PageDown", " "].includes(event.key) && advance()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  // The notes window follows the video, even full screen, and can play, pause or jump in it.
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    const player = video.current;
    const report = () => {
      if (!player) return;
      const { expanded, stepwise, finished } = latest.current;
      channel.postMessage({
        video: {
          time: player.currentTime,
          duration: player.duration,
          playing: !player.paused,
          full: expanded || document.fullscreenElement === player,
          stepwise,
          finished: finished(),
        },
      });
    };
    channel.onmessage = (event: MessageEvent<{ video?: unknown; step?: unknown }>) => {
      if (!player) return;
      if (typeof event.data.step === "number") latest.current.playStep(event.data.step);
      switch (event.data.video) {
        case "status":
        case "changed":
          return report();
        case "fullscreen":
          return latest.current.toggleFullScreen();
        case "advance":
          return void latest.current.advance();
        case "stepwise":
          return setStepwise((on) => !on);
        case "toggle":
          if (player.paused) player.play().catch(() => {});
          else player.pause();
      }
    };
    const events = ["timeupdate", "play", "pause", "seeked", "loadedmetadata", "ended"] as const;
    for (const name of events) player?.addEventListener(name, report);
    document.addEventListener("fullscreenchange", report);
    report();
    return () => {
      for (const name of events) player?.removeEventListener(name, report);
      document.removeEventListener("fullscreenchange", report);
      channel.close();
    };
  }, [missing]);

  // A change of mode or size is not a video event, so it is reported on its own.
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ video: "changed" });
    channel.close();
  }, [expanded, stepwise]);

  return (
    <div className="grid grid-cols-[19rem_1fr] items-center gap-8">
      <ol className="flex flex-col gap-1.5">
        {DEMO_STEPS.map(({ step, detail, optional }, index) => (
          <li key={step}>
            <button
              type="button"
              onClick={() => playStep(index)}
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-1.5 text-left transition-colors duration-300 ${
                optional ? "border-dashed" : ""
              } ${index === current ? "border-accent bg-accent-soft" : "border-line bg-panel"}`}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent font-mono text-sm font-semibold text-panel">
                {index + 1}
              </span>
              <span className="leading-tight">
                <span className="flex items-center gap-2 text-lg font-semibold">
                  {step}
                  {optional && <OptionalTag />}
                </span>
                <span className="text-sm text-muted">{detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-3">
        {missing ? (
          <div className="grid aspect-video place-items-center rounded-2xl border border-dashed border-line bg-panel p-6 text-center text-xl text-muted">
            Demo video: apps/web/public/pitch/demo.mp4
          </div>
        ) : (
          <video
            ref={video}
            src={DEMO_VIDEO}
            controls
            preload="auto"
            onError={() => setMissing(true)}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            className={
              expanded
                ? "fixed inset-0 z-50 h-full w-full bg-black object-contain"
                : "aspect-video w-full rounded-2xl border border-line bg-panel"
            }
          />
        )}
        <a
          href={liveScenarioRoute(DEMO_SCENARIO_ADDRESS)}
          target="_blank"
          rel="noreferrer"
          className="self-end text-lg font-medium text-accent hover:underline"
        >
          Open the live app on {CLUSTER.name} →
        </a>
      </div>
    </div>
  );
}

// Who does what, phase by phase. An empty cell means that actor has nothing to do then.
const ACTORS = ["Creator", "Holder", "Resolver"] as const;
const WORKFLOW: readonly Readonly<{ phase: string; cells: readonly (string | null)[] }>[] = [
  { phase: "Set up", cells: ["Publish scenario", null, "Prepare questions"] },
  { phase: "Issue", cells: ["Deposit → every piece", null, null] },
  { phase: "Distribute", cells: ["Keep bet, sell rest", "Receive or buy", null] },
  { phase: "Settle", cells: ["Redeem", "Redeem or sell", "Report results"] },
];

// The bond's payout to the customer against the reported downtime: the square for
// “down & down”, with “down” alone as the straight line for comparison.
const BOND = 10_000;
const BOND_ROWS = [0, 25, 50, 100].map((downtime) => {
  const paid = (BOND * downtime * downtime) / 10_000;
  return { downtime, paid, kept: BOND - paid };
});

function PayoutCurve() {
  const x = (downtime: number) => 62 + downtime * 3.2;
  const y = (share: number) => 245 - share * 2.1;
  const curve = Array.from({ length: 21 }, (_, step) => step * 5)
    .map(
      (downtime, index) =>
        `${index === 0 ? "M" : "L"}${x(downtime)},${y((downtime * downtime) / 100)}`,
    )
    .join(" ");
  return (
    <svg viewBox="0 0 400 285" className="w-full" role="img" aria-label="Payout of down & down">
      <line x1={x(0)} y1={y(0)} x2={x(100)} y2={y(0)} className="stroke-line" strokeWidth={2} />
      <line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(100)} className="stroke-line" strokeWidth={2} />
      <line
        x1={x(0)}
        y1={y(0)}
        x2={x(100)}
        y2={y(100)}
        className="stroke-muted"
        strokeWidth={2}
        strokeDasharray="6 6"
      />
      <path d={curve} fill="none" className="stroke-accent" strokeWidth={4} />
      {BOND_ROWS.filter(({ paid }) => paid > 0).map(({ downtime, paid }) => (
        <g key={downtime}>
          <circle
            cx={x(downtime)}
            cy={y((downtime * downtime) / 100)}
            r={5}
            className="fill-accent"
          />
          <text
            x={x(downtime) - 10}
            y={y((downtime * downtime) / 100) - 10}
            textAnchor="end"
            className="fill-current font-mono text-[15px] font-semibold"
          >
            {paid.toLocaleString("en-US")}
          </text>
        </g>
      ))}
      <text x={x(30)} y={y(42)} textAnchor="end" className="fill-muted text-[14px]">
        “down” alone
      </text>
      <text x={x(0)} y={277} className="fill-muted text-[14px]">
        0%
      </text>
      <text x={x(100)} y={277} textAnchor="end" className="fill-muted text-[14px]">
        100% down
      </text>
      <text x={x(50)} y={277} textAnchor="middle" className="fill-muted text-[14px]">
        downtime reported
      </text>
      <text x={x(0)} y={y(100) - 14} className="fill-muted text-[14px]">
        USDC paid to the customer
      </text>
      <text x={x(0) - 8} y={y(100) + 5} textAnchor="end" className="fill-muted text-[14px]">
        10,000
      </text>
      <text x={x(0) - 8} y={y(0) + 5} textAnchor="end" className="fill-muted text-[14px]">
        0
      </text>
    </svg>
  );
}

const SLIDES: readonly Slide[] = [
  {
    title: "Amp",
    notes:
      "Hi, I'm Anthony, / and with Lukas / we built Amp, / short for Ampersand Token. // It turns “A and B” into one asset on Solana, / from one deposit.",
    body: (
      <div className="flex h-full flex-col justify-center">
        <div className="flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-xl bg-accent text-4xl font-bold text-panel">
            &amp;
          </span>
          <div className="flex flex-col">
            <span className="text-3xl leading-none font-semibold">Amp</span>
            <span className="mt-1.5 text-lg leading-none text-muted">Ampersand Token</span>
          </div>
        </div>
        <h1 className="mt-10 text-7xl leading-tight font-semibold tracking-tight">
          One asset for <span className="text-accent">“A &amp; B”</span>
        </h1>
        <p className="mt-6 text-3xl text-muted">Combinatorial conditional tokens on Solana</p>
      </div>
    ),
  },
  {
    title: "Two markets cannot tell you how two events are linked",
    notes:
      "In today's prediction markets, / each market prices one event: / fifty percent for a Fed cut, / forty percent for the SOL price at two hundred or more. // But no market prices both together. // Two separate bets are not the same thing: / if only one happens, / one of them still pays. // And that combined bet is exactly what people are asking for.",
    body: (
      <div className="flex flex-col gap-8">
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <div className="flex items-center gap-2 text-xl text-muted">
              <QuestionTag number={1} /> Market
            </div>
            <div className="mt-2 text-3xl font-medium">The Fed cuts rates in December</div>
            <div className="mt-4 font-mono text-6xl font-semibold">50%</div>
          </Card>
          <Card>
            <div className="flex items-center gap-2 text-xl text-muted">
              <QuestionTag number={2} /> Market
            </div>
            <div className="mt-2 text-3xl font-medium">SOL price at $200 or more at year end</div>
            <div className="mt-4 font-mono text-6xl font-semibold">40%</div>
          </Card>
        </div>
        <Card tone="accent">
          <div className="flex items-baseline justify-between gap-6">
            <span className="text-3xl font-medium">Both?</span>
            <span className="text-2xl text-muted">No market prices that.</span>
          </div>
        </Card>
        <p className="text-2xl text-muted">
          Today: two separate bets. If only one happens, one still pays: not a bet on both.
        </p>
      </div>
    ),
  },
  {
    title: "Combos are where prediction markets are growing",
    notes:
      "In September twenty twenty-five, Kalshi launched combos, / with over a hundred million dollars traded in the first week. / Polymarket followed this June. // But there, a combo is a bet you place on their platform. // We wanted the combination itself to be a token / that anyone can create and hold. // Here's how that works.",
    body: (
      <div className="flex flex-col gap-8">
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <div className="text-xl text-muted">Kalshi Combos · September 2025</div>
            <div className="mt-3 text-3xl font-medium">$100M+ traded in the first week</div>
          </Card>
          <Card>
            <div className="text-xl text-muted">Polymarket Combos · June 2026</div>
            <div className="mt-3 text-3xl font-medium">Up to 10 legs in one trade</div>
          </Card>
        </div>
        <p className="text-3xl leading-snug font-medium">
          There, a combo is a bet on their platform. Amp makes it{" "}
          <span className="text-accent">a token</span> anyone can create and hold.
        </p>
      </div>
    ),
  },
  {
    title: "Deposit once. Hold every combination.",
    notes:
      "I deposit a hundred tokens of collateral / and split it by question and result: / the Fed, / then the SOL price. // That gives four positions, one per combination. / The winning one pays, / and together they are always worth the scenario's collateral. // Each is an asset I can hold, send, or wrap as an ordinary token. // So far every result is a clean yes or no. / It doesn't have to be.",
    body: (
      <div className="flex flex-col items-center gap-3 text-xl">
        <div className="rounded-xl border border-line bg-panel px-8 py-3 text-center">
          <div className="font-medium">Deposit</div>
          <div className="mt-1 font-mono text-sm text-muted">100 tokens of collateral</div>
        </div>
        <Question number={1} split="split on" text="Does the Fed cut?" />
        <div className="grid w-full grid-cols-2 gap-6">
          <Box label="cut" />
          <Box label="no cut" />
        </div>
        <Question number={2} split="split each on" text="SOL price at $200 or more?" />
        <div className="grid w-full grid-cols-4 gap-4">
          <Box label="cut & SOL price ≥ $200" featured />
          <Box label="cut & SOL price < $200" />
          <Box label="no cut & SOL price ≥ $200" />
          <Box label="no cut & SOL price < $200" />
        </div>
        <p className="mt-6 max-w-4xl text-center text-2xl text-muted">
          The winning one pays, and together they are always worth the scenario's collateral. Each
          is an asset to hold, send, or wrap as an ordinary token.
        </p>
      </div>
    ),
  },
  {
    title: "Beyond betting: outage insurance with a curved payout",
    compact: true,
    notes:
      "The resolver can also report a share, / and that takes us beyond betting. // Take an RPC provider / that insures its customers against downtime. // It locks ten thousand USDC, / and at the end of the month / the resolver reports what proportion of the month the service was down. // [Point at the curve.] / The payout grows with the outage: / a short outage pays very little, / a long one pays a lot, / a total outage pays everything. // We get that curve by using the same question twice. // Let me show you the whole flow with a recording we did on devnet.",
    body: (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-8">
          <ol className="flex flex-col gap-3 text-xl">
            {(
              [
                ["Deposit a bond", "The RPC provider locks 10,000 USDC."],
                [
                  "Split twice on one question",
                  <Question
                    key="question"
                    text="What proportion of the month was the RPC service down?"
                  />,
                ],
                ["Sell “down & down”", "Customers buy it as outage insurance."],
              ] as const
            ).map(([step, detail], index) => (
              <li key={step}>
                <Card tone={index === 2 ? "accent" : "plain"} compact>
                  <div className="font-semibold">{step}</div>
                  <div className="mt-1.5 text-lg text-muted">{detail}</div>
                </Card>
              </li>
            ))}
          </ol>
          <PayoutCurve />
        </div>
        <table className="w-full text-left font-mono text-xl">
          <tbody>
            {(
              [
                ["Downtime", ({ downtime }) => `${downtime}%`],
                ["Customer gets", ({ paid }) => paid.toLocaleString("en-US")],
                ["Provider keeps", ({ kept }) => kept.toLocaleString("en-US")],
              ] as const satisfies readonly (readonly [
                string,
                (row: (typeof BOND_ROWS)[number]) => string,
              ])[]
            ).map(([label, cell], row) => (
              <tr key={label} className="border-b border-line last:border-0">
                <th className="py-1.5 pr-6 font-sans text-lg font-medium text-muted">{label}</th>
                {BOND_ROWS.map((bond) => (
                  <td
                    key={bond.downtime}
                    className={`py-1.5 text-right ${row === 1 ? "font-semibold text-accent" : ""}`}
                  >
                    {cell(bond)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  {
    title: "Demo",
    compact: true,
    demo: true,
    notes:
      "Quick warning: / it has been edited and sped up, / so if you get motion sickness, / now is a good time to look away. // [Press → to play each step; → after the last one moves on.]",
    after: "So that's the full lifecycle. // How does it compare with what exists?",
    body: <Demo />,
  },
  {
    title: "How it compares",
    notes:
      "Separate markets can't do “A and B”. / Platform combos can, / but only for what the platform lists. // With Amp, anyone creates any combination, / results can be shared, / and each position is a token any wallet can hold. // The idea comes from Gnosis conditional tokens on Ethereum. / We bring it to Solana. // So where does it stand?",
    body: (
      <table className="w-full text-left text-2xl">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pr-4 font-medium" />
            <th className="py-2 pr-4 font-medium">Separate markets</th>
            <th className="py-2 pr-4 font-medium">Platform combos</th>
            <th className="py-2 font-medium text-accent">Ampersand Token</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON.map(([what, separate, platform, combined]) => (
            <tr key={what} className="border-b border-line last:border-0">
              <td className="py-3 pr-4 text-xl text-muted">{what}</td>
              <td className="py-3 pr-4">
                <ComparisonCell value={separate} />
              </td>
              <td className="py-3 pr-4">
                <ComparisonCell value={platform} />
              </td>
              <td className="py-3 font-medium">
                <ComparisonCell value={combined} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ),
  },
  {
    title: "Where it stands",
    notes:
      "The program is deployed on devnet, / with a TypeScript SDK and our demo app, / tested on devnet. // Next: a market for these tokens, / so anyone can trade “A and B” / as easily as a single bet. // And we're not the only ones who think this matters: / Galaxy Research just published a report on conditional markets. // Thank you.",
    body: (
      <div className="flex flex-col gap-8">
        <div className="grid grid-cols-2 gap-6 text-2xl">
          <Card>
            <div className="text-xl text-muted">Today</div>
            <div className="mt-3 font-medium">Deployed on {CLUSTER.name}</div>
            <div className="mt-1 font-mono text-sm break-all text-muted">
              {CC_TOKEN_PROGRAM_ADDRESS}
            </div>
            <p className="mt-3 text-xl text-muted">Program, TypeScript SDK and demo app.</p>
          </Card>
          <Card tone="accent">
            <div className="text-xl text-muted">Next</div>
            <div className="mt-3 font-medium">A market that prices these tokens</div>
          </Card>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <span className="text-5xl font-semibold tracking-tight">Thank you</span>
          <span className="font-mono text-xl text-muted">
            cc-token.vercel.app · github.com/neodyma/cc-token
          </span>
        </div>
      </div>
    ),
  },
  // Kept after the close, for questions: the talk itself ends on the slide before.
  {
    title: "Backup: where Amp fits",
    notes:
      "Galaxy Research groups these as conditional markets. // Decision markets let a market decide, / like MetaDAO on Solana. / Impact markets price how an event moves an asset. // Each splits on one event. / Amp combines any questions / into one token anyone can create and hold. // And the tokens carry impact for free: / compare “cut and SOL at two hundred or more” / with “no cut and SOL at two hundred or more”.",
    body: (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-3 gap-6 text-2xl">
          <Card>
            <div className="text-xl text-muted">Decision markets</div>
            <div className="mt-3 font-medium">A market decides whether a proposal passes</div>
            <p className="mt-3 text-xl text-muted">MetaDAO (Solana) · Umia</p>
          </Card>
          <Card>
            <div className="text-xl text-muted">Impact markets</div>
            <div className="mt-3 font-medium">How an event moves an asset's price</div>
            <p className="mt-3 text-xl text-muted">Proof · If Market · Lightcone</p>
          </Card>
          <Card tone="accent">
            <div className="text-xl text-muted">The token layer</div>
            <div className="mt-3 font-medium">Any combination of questions, as one token</div>
            <p className="mt-3 text-xl text-muted">Amp on Solana · Branchpoint (EVM pilot)</p>
          </Card>
        </div>
        <p className="text-2xl">
          Impact for free: “cut &amp; SOL ≥ $200” next to “no cut &amp; SOL ≥ $200” shows how the
          Fed moves SOL.
        </p>
        <p className="text-base text-muted">
          Grouping from Galaxy Research, “Conditional Markets Are Beginning to Blossom”, 15 October
          2026.
        </p>
      </div>
    ),
  },
  {
    title: "Backup: who does what",
    notes:
      "There are three roles. // The creator publishes the scenario, deposits, / keeps the piece it believes in / and sells the rest. // Holders receive or buy those pieces, / then redeem or sell them. // The resolver prepares each question / and reports its result. // And the collateral sits in the program's vault, / with no admin.",
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
    title: "Backup: a payout that follows a price",
    notes:
      "The same weights give a payout that follows a price. // One question: / where does the SOL price settle between a hundred and three hundred dollars, / with two results, / high and low. // If it settles at two hundred fifty, / three quarters of the way up, / the resolver reports seventy-five for high / and twenty-five for low. // A hundred shares of high pay seventy-five, / a hundred of low pay twenty-five: / still exactly the hundred deposited. // And it combines like any question: / “the Fed cuts, and high” / pays seventy-five only if the Fed cut.",
    body: (
      <div className="flex flex-col gap-8">
        <Card>
          <div className="text-xl text-muted">One question, two results: high and low</div>
          <div className="mt-3 text-2xl">
            <Question text="Where does the SOL price settle between $100 and $300?" />
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
          It combines like any other question: “cut & high” pays seventy-five only if the Fed cut.
        </p>
      </div>
    ),
  },
  {
    title: "Backup: the outage bond, piece by piece",
    compact: true,
    notes:
      "Here is where every unit of the bond goes. // The provider splits the ten thousand on the downtime question / into “down” and “up”, / then splits “down” again on the same question. // That leaves three positions. / The customer holds “down and down”; / the provider keeps “down and up” and “up”. // Whatever the downtime, / the three always add up to the ten thousand. // And the order doesn't matter: / “down and up” and “up and down” / are the same position, / with the same ID.",
    body: (
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3 text-xl">
          <span className="text-muted">10,000 USDC, split twice on</span>
          <Question text="What proportion of the month was the RPC service down?" />
        </div>
        <table className="w-full text-left font-mono text-2xl">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-6 font-sans text-xl font-medium">Downtime</th>
              {BOND_ROWS.map(({ downtime }) => (
                <th key={downtime} className="py-2 text-right font-medium">
                  {downtime}%
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["“down & down”, customer", (down: number) => down * down, true],
                ["“down & up”, provider", (down: number) => down * (1 - down), false],
                ["“up”, provider", (down: number) => 1 - down, false],
                ["Total", () => 1, false],
              ] as const
            ).map(([label, share, customer]) => (
              <tr
                key={label}
                className={`border-b border-line last:border-0 ${customer ? "font-semibold text-accent" : ""}`}
              >
                <th className="py-2 pr-6 font-sans text-xl font-medium">{label}</th>
                {BOND_ROWS.map(({ downtime }) => (
                  <td key={downtime} className="py-2 text-right">
                    {(BOND * share(downtime / 100)).toLocaleString("en-US")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-2xl text-muted">
          “down & up” and “up & down” are the same position, whatever the order it is built in.
          Splitting a third time on the same question gives the cube.
        </p>
      </div>
    ),
  },
  {
    title: "Backup: what you have to trust",
    notes:
      "Who do you have to trust? // The resolver, / and only for its own question. / It is named when the question is prepared, / it reports once, / and the result is final. / That can be an oracle, / a multisig / or a DAO. // Nobody else: / the program has no admin, / and the collateral only leaves through a full-set merge / or a redemption. // Any collateral that its issuer can freeze / is flagged as such, / and has to be accepted explicitly.",
    body: (
      <div className="grid grid-cols-3 gap-5 text-xl">
        <Card tone="accent">
          <div className="font-semibold">The resolver, per question</div>
          <p className="mt-2 text-muted">
            Named when the question is prepared. Reports once, and the result is final. An oracle, a
            multisig or a DAO.
          </p>
        </Card>
        <Card>
          <div className="font-semibold">No admin</div>
          <p className="mt-2 text-muted">
            Collateral sits in a vault owned by the program, and leaves only by merging a full set
            or redeeming a result.
          </p>
        </Card>
        <Card>
          <div className="font-semibold">Freezable collateral is flagged</div>
          <p className="mt-2 text-muted">
            A token whose issuer can freeze it is marked as issuer-controlled and needs explicit
            acceptance before a deposit.
          </p>
        </Card>
      </div>
    ),
  },
  {
    title: "Backup: how it works",
    notes:
      "Each position's ID comes from its questions and results, / and it's the same whatever order you build it in. // Collateral sits in a vault, / and only leaves through a full-set merge or a redemption. // And any group of results on a question is one position, / so a price range needs no new oracle question.",
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

// The slides and the presenter's notes are two windows of the same app. Whichever one moves
// tells the other, so only the slides window needs to be shared.
const CHANNEL = "cc-token-pitch";
const PRESENTER_WINDOW = "cc-token-presenter";

function useSlideSync(index: number, route: (slide: number) => string) {
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<{ slide?: unknown }>) => {
      const slide = event.data.slide;
      if (typeof slide === "number" && slide !== index) window.location.hash = route(slide);
    };
    channel.postMessage({ slide: index });
    return () => channel.close();
  }, [index, route]);
}

function useSlideKeys(index: number, route: (slide: number) => string, onNotes: () => void) {
  useEffect(() => {
    const go = (next: number) => {
      if (next >= 0 && next < SLIDES.length) window.location.hash = route(next);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("video")) return;
      if (["ArrowRight", "PageDown", " "].includes(event.key)) {
        event.preventDefault();
        go(index + 1);
      } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
        event.preventDefault();
        go(index - 1);
      } else if (event.key === "n" || event.key === "N") {
        onNotes();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, route, onNotes]);
}

function openPresenter(index: number) {
  window.open(presenterRoute(index), PRESENTER_WINDOW, "popup,width=960,height=720");
}

export function Presentation(props: { index: number }) {
  const index = Math.min(Math.max(props.index, 0), SLIDES.length - 1);
  const slide = SLIDES[index]!;
  useSlideSync(index, pitchRoute);
  const notes = useCallback(() => openPresenter(index), [index]);
  useSlideKeys(index, pitchRoute, notes);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.location.hash = ROUTES.simulator;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-page text-ink">
      {index === 0 && (
        <a
          href="https://turbin3.org/"
          target="_blank"
          rel="noreferrer"
          className="absolute top-6 right-8 flex flex-col items-end gap-1.5 text-muted hover:text-ink"
        >
          {/* Turbin3's wordmark, with its white lettering in the page's text colour. */}
          <span
            aria-label="Turbin3"
            className="text-ink [&>svg]:h-6 [&>svg]:w-auto"
            dangerouslySetInnerHTML={{ __html: turbin3Logo }}
          />
          <span className="text-sm">Builders Q3 cohort</span>
        </a>
      )}
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

      <footer className="flex items-center gap-4 border-t border-line px-6 py-2 text-sm text-muted">
        <a href={ROUTES.simulator} className="hover:text-ink">
          Esc · exit
        </a>
        <button type="button" onClick={notes} className="hover:text-ink">
          N · notes window
        </button>
        <SlideArrows index={index} route={pitchRoute} />
      </footer>
    </div>
  );
}

function SlideArrows(props: { index: number; route: (slide: number) => string }) {
  const { index, route } = props;
  return (
    <span className="ml-auto flex items-center gap-3">
      <a
        href={route(Math.max(index - 1, 0))}
        aria-label="Previous slide"
        className={index === 0 ? "pointer-events-none opacity-30" : "hover:text-ink"}
      >
        ←
      </a>
      <span className="font-mono">
        {index + 1} / {SLIDES.length}
      </span>
      <a
        href={route(Math.min(index + 1, SLIDES.length - 1))}
        aria-label="Next slide"
        className={
          index === SLIDES.length - 1 ? "pointer-events-none opacity-30" : "hover:text-ink"
        }
      >
        →
      </a>
    </span>
  );
}

// Notes are written to be spoken: “ / ” marks a breath and “ // ” a longer pause, which
// starts a new line. Stage directions are in square brackets.
function Spoken(props: { text: string }) {
  return props.text.split(/(\[[^\]]*\]| \/ )/).map((part, index) =>
    part === " / " ? (
      <span key={index} className="mx-1.5 font-semibold text-accent opacity-60">
        /
      </span>
    ) : part.startsWith("[") ? (
      <span key={index} className="text-xl text-accent italic">
        {part}
      </span>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

function Notes(props: { text: string }) {
  return (
    <div className="flex flex-col gap-4 text-2xl leading-relaxed">
      {props.text.split(" // ").map((chunk, index) => (
        <p key={index}>
          <Spoken text={chunk} />
        </p>
      ))}
    </div>
  );
}

// Seconds to say a text aloud, pauses included.
function speakingTime(text: string): number {
  const plain = text.replace(/\[[^\]]*\]/g, "");
  const words = plain.split(/\s+/).filter((word) => word !== "" && !/^\/+$/.test(word)).length;
  const breaths = plain.split(" / ").length - 1;
  const pauses = plain.split(" // ").length - 1;
  return words / WORDS_PER_SECOND + breaths * 0.4 + pauses;
}

type VideoState = Readonly<{
  time: number;
  duration: number;
  playing: boolean;
  full: boolean;
  // Pauses after each step; the next-slide keys then play the next one.
  stepwise: boolean;
  finished: boolean;
}>;

// The demo video as the slides window reports it: where it is, and what to say there.
function DemoNotes() {
  const [video, setVideo] = useState<VideoState | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const open = new BroadcastChannel(CHANNEL);
    open.onmessage = (event: MessageEvent<{ video?: VideoState }>) => {
      if (typeof event.data.video === "object") setVideo(event.data.video);
    };
    channel.current = open;
    open.postMessage({ video: "status" });
    return () => open.close();
  }, []);
  const current = video ? demoStepAt(video.time) : -1;

  // Through the opener, the click carries over and the browser allows real full screen.
  const fullScreen = useCallback(() => {
    const message = { video: "fullscreen" };
    if (window.opener) {
      (window.opener as Window).postMessage(message, {
        targetOrigin: window.location.origin,
        delegate: "fullscreen",
      } as WindowPostMessageOptions);
    } else {
      channel.current?.postMessage(message);
    }
  }, []);
  // While steps remain, the next-slide keys play the next step instead of leaving the slide.
  const latest = useRef(video);
  latest.current = video;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const state = latest.current;
      if (event.key === "f" || event.key === "F") {
        fullScreen();
      } else if (
        ["ArrowRight", "PageDown", " "].includes(event.key) &&
        state?.stepwise &&
        !state.finished
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        channel.current?.postMessage({ video: "advance" });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [fullScreen]);

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => channel.current?.postMessage({ video: "toggle" })}
          className="rounded-md border border-accent bg-accent px-4 py-2 text-base font-medium text-panel"
        >
          {video?.playing
            ? "Pause video"
            : video?.stepwise && !video.finished && video.time > 0
              ? "Play next step · →"
              : "Play video · →"}
        </button>
        <button
          type="button"
          onClick={fullScreen}
          className="rounded-md border border-line px-4 py-2 text-base hover:bg-panel"
        >
          {video?.full ? "Exit full screen" : "Full screen"} <span className="text-muted">· F</span>
        </button>
        <span className="font-mono text-lg text-muted">
          {video ? `${clock(video.time)} / ${clock(video.duration || 0)}` : "video not loaded yet"}
        </span>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={video?.stepwise ?? true}
            onChange={() => channel.current?.postMessage({ video: "stepwise" })}
          />
          Pause after each step
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {DEMO_STEPS.map(({ step, optional }, index) => (
          <button
            key={step}
            type="button"
            onClick={() => channel.current?.postMessage({ step: index })}
            className={`rounded-md border px-2.5 py-1 text-sm ${optional ? "border-dashed italic" : ""} ${
              index === current
                ? "border-accent bg-accent font-semibold text-panel"
                : "border-line text-muted hover:text-ink"
            }`}
          >
            {index + 1} {step}
          </button>
        ))}
      </div>
      {current >= 0 && (
        <div className="rounded-lg border border-accent bg-accent-soft px-5 py-4">
          <div className="flex items-center gap-2 text-sm text-muted">
            Step {current + 1} of {DEMO_STEPS.length}
            {DEMO_STEPS[current]!.optional && <OptionalTag />}
          </div>
          <div className="mt-1 text-3xl leading-snug">
            <span className="font-semibold">{DEMO_STEPS[current]!.step}.</span>{" "}
            <Spoken text={DEMO_STEPS[current]!.say} />
          </div>
        </div>
      )}
    </div>
  );
}

const TALK_SECONDS = 5 * 60;
const WORDS_PER_SECOND = 2.5;

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function PresenterView(props: { index: number }) {
  const index = Math.min(Math.max(props.index, 0), SLIDES.length - 1);
  const slide = SLIDES[index]!;
  const next = SLIDES[index + 1];
  useSlideSync(index, presenterRoute);
  const none = useCallback(() => {}, []);
  useSlideKeys(index, presenterRoute, none);

  const [started, setStarted] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, (now - started) / 1000);
  const seconds = speakingTime(
    [slide.notes, ...(slide.demo ? DEMO_STEPS.map(({ say }) => say) : []), slide.after ?? ""].join(
      " // ",
    ),
  );

  return (
    <div className="fixed inset-0 flex flex-col bg-page text-ink">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-6 py-3">
        <span className="font-mono text-lg">
          {index + 1} / {SLIDES.length}
        </span>
        <span className="text-lg font-semibold">{slide.title}</span>
        <span className="ml-auto flex items-center gap-4">
          <span
            className={`font-mono text-2xl font-semibold ${elapsed > TALK_SECONDS ? "text-bad" : ""}`}
          >
            {clock(elapsed)}
          </span>
          <span className="text-sm text-muted">of {clock(TALK_SECONDS)}</span>
          <button
            type="button"
            onClick={() => {
              setStarted(Date.now());
              setNow(Date.now());
            }}
            className="rounded-md border border-line px-2 py-1 text-sm hover:bg-panel"
          >
            Restart timer
          </button>
        </span>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-3 text-sm text-muted">About {Math.round(seconds)} s</div>
        <Notes text={slide.notes} />
        {slide.demo && <DemoNotes />}
        {slide.after && (
          <div className="mt-5">
            <Notes text={slide.after} />
          </div>
        )}
      </main>

      <footer className="flex flex-wrap items-center gap-4 border-t border-line px-6 py-3 text-sm text-muted">
        <span>
          Next: <span className="text-ink">{next ? next.title : "end of the deck"}</span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <a
            href={presenterRoute(Math.max(index - 1, 0))}
            className="rounded-md border border-line px-4 py-2 text-base hover:bg-panel"
          >
            ← Back
          </a>
          <a
            href={presenterRoute(Math.min(index + 1, SLIDES.length - 1))}
            className="rounded-md border border-accent bg-accent px-4 py-2 text-base text-panel"
          >
            Next →
          </a>
        </span>
      </footer>
    </div>
  );
}
