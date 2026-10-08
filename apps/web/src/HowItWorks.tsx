import type { ReactNode } from "react";

const SECTIONS = [
  { id: "short-version", title: "The short version" },
  { id: "example", title: "One example, start to finish" },
  { id: "why", title: "What this makes possible" },
  { id: "twice", title: "Using one question twice" },
  { id: "words", title: "Words and protocol terms" },
  { id: "questions", title: "Common questions" },
  { id: "demo", title: "What this demo does" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

// The page itself is selected through the URL hash, so sections scroll instead of linking.
function scrollToSection(id: SectionId) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Section(props: { id: SectionId; children: ReactNode }) {
  return (
    <section id={props.id} className="scroll-mt-20 rounded-xl border border-line bg-panel p-6">
      <h2 className="text-xl font-semibold">
        {SECTIONS.find((section) => section.id === props.id)!.title}
      </h2>
      <div className="mt-4 flex flex-col gap-4 leading-relaxed">{props.children}</div>
    </section>
  );
}

function Step(props: { number: number; title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h3 className="flex items-baseline gap-3 text-lg font-medium">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-sm text-accent">
          {props.number}
        </span>
        {props.title}
      </h3>
      <div className="mt-3 flex flex-col gap-3 sm:pl-10">{props.children}</div>
    </div>
  );
}

function Diagram(props: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-stretch gap-3 rounded-lg bg-page p-4">
      {props.children}
    </div>
  );
}

function Box(props: { top: string; children: ReactNode; tone?: "plain" | "accent" | "good" }) {
  const tone =
    props.tone === "accent"
      ? "border-accent bg-accent-soft"
      : props.tone === "good"
        ? "border-good bg-good-soft"
        : "border-line bg-panel";
  return (
    <div className={`min-w-36 flex-1 rounded-lg border px-3 py-2 ${tone}`}>
      <div className="font-mono text-sm">{props.top}</div>
      <div className="text-sm text-muted">{props.children}</div>
    </div>
  );
}

function Arrow(props: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-1 text-muted">
      {props.label && <span className="text-xs">{props.label}</span>}
      <span aria-hidden="true" className="text-xl leading-none">
        →
      </span>
    </div>
  );
}

function Stack(props: { children: ReactNode }) {
  return <div className="flex min-w-36 flex-1 flex-col gap-3">{props.children}</div>;
}

function Table(props: { head: readonly string[]; rows: readonly (readonly string[])[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            {props.head.map((cell) => (
              <th key={cell} className="border-b border-line py-2 pr-4 font-normal">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column} className="border-b border-line py-2 pr-4 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Question(props: { ask: string; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="font-medium">{props.ask}</h3>
      <p className="mt-1 text-muted">{props.children}</p>
    </div>
  );
}

export function HowItWorks() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav className="rounded-xl border border-line bg-panel p-5 lg:sticky lg:top-20">
        <h2 className="text-sm font-semibold tracking-wide uppercase">On this page</h2>
        <ul className="mt-3 flex flex-col gap-1">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => scrollToSection(section.id)}
                className="w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-page"
              >
                {section.title}
              </button>
            </li>
          ))}
        </ul>
        <a
          href="#/"
          className="mt-4 block rounded-md bg-accent px-3 py-2 text-center text-sm font-medium text-panel"
        >
          Try it in the Composer
        </a>
      </nav>

      <div className="flex max-w-4xl flex-col gap-6">
        <Section id="short-version">
          <p className="text-lg">
            cc-token lets you lock tokens and receive shares that pay out depending on how a
            real-world question turns out. You decide which results you want to be paid on.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Box top="1. Lock" tone="accent">
              Deposit tokens such as USDC. They are held as collateral until claims are redeemed or
              merged back.
            </Box>
            <Box top="2. Shape" tone="accent">
              Receive shares covering every possible result. Split them, combine them with other
              questions, keep some and sell the rest.
            </Box>
            <Box top="3. Redeem" tone="accent">
              Once the result is known, each share pays between 0 and 1 token. All shares together
              pay back exactly what was locked.
            </Box>
          </div>
          <p>
            It is a building block, not a marketplace. It defines the shares and guarantees what
            they are worth together; it does not set prices or match buyers with sellers. An
            exchange or app would do that on top.
          </p>
        </Section>

        <Section id="example">
          <p className="text-muted">
            Maya has 100 USDC and a view on where SOL will be at the end of the year. Each step
            below is something the protocol lets her do.
          </p>

          <Step number={1} title="Start from a question">
            <p>
              A question has a fixed list of possible results, and names one party, the resolver,
              who will report which result happened. A question can have from 2 to 256 results.
            </p>
            <Diagram>
              <Box top="SOL price at year end">One question, four possible results</Box>
              <Arrow />
              <Box top="below $100">result 1</Box>
              <Box top="$100 to $150">result 2</Box>
              <Box top="$150 to $200">result 3</Box>
              <Box top="$200 or more">result 4</Box>
            </Diagram>
          </Step>

          <Step number={2} title="Deposit, and receive shares covering every result">
            <p>
              Maya does not buy a bet from the protocol. Her deposit is split into groups of results
              that she chooses, and she receives the same number of shares in each group. A group of
              results is called a claim. Here she cuts the question at $150.
            </p>
            <Diagram>
              <Box top="100 USDC">locked as collateral</Box>
              <Arrow label="deposit" />
              <Stack>
                <Box top="100 shares" tone="accent">
                  SOL ends below $150
                </Box>
                <Box top="100 shares">SOL ends at $150 or more</Box>
              </Stack>
            </Diagram>
            <p>
              One of the two is certain to pay, so holding both is the same as holding the 100 USDC.
              Nothing has been risked yet.
            </p>
          </Step>

          <Step number={3} title="Take a position by keeping some claims and selling others">
            <p>
              Maya thinks SOL will end below $150. She keeps that claim and sells the other one to
              someone who thinks the opposite. If they pay her 0.60 USDC per share, she gets 60 USDC
              back and her 100 remaining shares have cost her 40.
            </p>
            <Diagram>
              <Box top="100 shares" tone="accent">
                below $150, kept
              </Box>
              <Box top="+ 60 USDC">from selling the "$150 or more" claim</Box>
              <Arrow />
              <Box top="net cost 40 USDC">0.40 per share, paying 1 each if she is right</Box>
            </Diagram>
            <p>
              Someone else could skip the deposit and simply buy the "below $150" claim from a
              holder at its market price. Either way, the selling and buying happen outside the
              protocol.
            </p>
          </Step>

          <Step number={4} title="Split a claim into narrower ones, or merge them back">
            <p>
              A claim covering several results can be cut into smaller claims at any time, with no
              new deposit and no new question. The pieces can be merged back the same way.
            </p>
            <Diagram>
              <Box top="100 shares" tone="accent">
                below $150
              </Box>
              <Arrow label="split" />
              <Stack>
                <Box top="100 shares">below $100</Box>
                <Box top="100 shares">$100 to $150</Box>
              </Stack>
              <Arrow label="merge" />
              <Box top="100 shares" tone="accent">
                below $150
              </Box>
            </Diagram>
            <p>
              Systems that issue one token per result cannot do this. A wide range can be sold first
              and cut into narrower ranges later, as interest grows. Merging a complete set of
              claims, one that covers every result, unlocks the collateral without waiting for the
              result.
            </p>
          </Step>

          <Step number={5} title="Add a second question">
            <p>
              A claim can be split by a different question. The pieces pay only if both questions go
              the right way.
            </p>
            <Diagram>
              <Box top="100 shares" tone="accent">
                below $150
              </Box>
              <Arrow label="split by volatility" />
              <Stack>
                <Box top="100 shares">below $150 and high volatility</Box>
                <Box top="100 shares">below $150 and low volatility</Box>
              </Stack>
            </Diagram>
            <p>
              The order does not matter. Someone who starts from the volatility question and adds
              the price question ends up with the very same asset, with the same ID, so the two of
              them can trade with each other.
            </p>
            <Diagram>
              <Stack>
                <Box top="price, then volatility">Maya's route</Box>
                <Box top="volatility, then price">someone else's route</Box>
              </Stack>
              <Arrow />
              <Box top="one asset ID" tone="good">
                below $150 and high volatility
              </Box>
            </Diagram>
          </Step>

          <Step number={6} title="The result is reported, and shares are redeemed">
            <p>
              After the year ends, the resolver reports the result. It is reported once and is
              final. Each share then pays out of the locked collateral.
            </p>
            <Table
              head={["Reported result", '"below $150" pays', '"$150 or more" pays', "Together"]}
              rows={[
                ["SOL ended at $120", "100 USDC", "0 USDC", "100 USDC"],
                ["SOL ended at $180", "0 USDC", "100 USDC", "100 USDC"],
                [
                  "Shared: a quarter to below $150, the rest above",
                  "25 USDC",
                  "75 USDC",
                  "100 USDC",
                ],
              ]}
            />
            <p>
              Maya paid 40 USDC for her 100 shares. She receives 100 if SOL ended below $150 and
              nothing if it did not. She can never lose more than the 40 she paid.
            </p>
            <p className="text-muted">
              The shared row is for results that are not all-or-nothing, such as a tie or a measured
              percentage. The resolver reports weights, and each claim is paid its portion.
            </p>
          </Step>
        </Section>

        <Section id="why">
          <div className="grid gap-3 sm:grid-cols-3">
            <Box top="Any group is one asset">
              "$125 to $200" is a single claim, not three separate bets. One question about a price
              can back every range anyone wants to trade.
            </Box>
            <Box top="Refine later">
              A broad claim can be cut into narrower ones after it exists, without opening or
              resolving a new market for each piece.
            </Box>
            <Box top="One asset, any route">
              The same combination of questions is always the same asset, however it was built, so
              buyers and sellers meet in one place.
            </Box>
          </div>
          <p>
            The collateral does not have to be a stablecoin. A DAO can split its own token by "does
            the proposal pass", which lets people trade the token as it would be in each case.
          </p>
        </Section>

        <Section id="twice">
          <p>
            Usually each question appears once in a claim. When the same question is used twice,
            there are two different things that could mean, and the Composer asks which you want.
          </p>
          <Table
            head={["Mode", "What happens", "If the question pays a portion r"]}
            rows={[
              [
                "Logical AND",
                'The two selections are narrowed to what they share: "below $150" and "$100 or more" becomes "$100 to $150".',
                "pays r",
              ],
              [
                "Explicit product",
                "Both selections are kept and applied one after the other.",
                "pays r × r",
              ],
            ]}
          />
          <p>
            The two only differ when a result is shared. The uptime bond scenario uses the product
            deliberately: with 25% downtime it pays 25% of 25%, so the payout grows faster the worse
            the outage.
          </p>
          <Diagram>
            <Box top="10,000 shares">downtime × downtime</Box>
            <Arrow label="× 1/4" />
            <Box top="2,500">after the first</Box>
            <Arrow label="× 1/4" />
            <Box top="625 USDC" tone="good">
              paid out
            </Box>
          </Diagram>
        </Section>

        <Section id="words">
          <p className="text-muted">
            This site uses everyday words. The protocol and its code use the terms on the right.
          </p>
          <Table
            head={["On this site", "Protocol term", "Meaning"]}
            rows={[
              [
                "Question",
                "Condition",
                "Something with a fixed list of possible results and one resolver.",
              ],
              ["Result", "Outcome", "One of the possible answers to a question."],
              ["Claim", "Position", "Shares that pay when a chosen group of results happens."],
              [
                "Selection",
                "Factor, or index set",
                "The group of results a claim uses from one question.",
              ],
              ["Asset ID", "Position ID", "Identifies a claim together with the token backing it."],
              [
                "Deposit",
                "Split from collateral",
                "Locking tokens and receiving a full set of claims.",
              ],
              [
                "Cash out a full set",
                "Merge to collateral",
                "Returning a full set of claims to unlock the tokens.",
              ],
              [
                "Weights",
                "Payout numerators",
                "How the resolver divides the payout between results.",
              ],
              ["Collateral", "Collateral", "The locked tokens that every share is paid from."],
            ]}
          />
        </Section>

        <Section id="questions">
          <Question ask="Who decides the result?">
            The resolver named when the question was created. The protocol does not judge whether a
            report is true; it applies whatever the resolver reports. Trusting a claim means
            trusting the resolver of every question in it.
          </Question>
          <Question ask="Can I lose more than I put in?">
            No. A share pays between 0 and 1 token and never asks for more. The most you can lose is
            what you paid for the shares you hold.
          </Question>
          <Question ask="Where do prices come from?">
            From wherever claims are traded. Because a full set is always worth its collateral, the
            prices of the claims in a set should add up to 1, and a claim priced at 0.30 is the
            market saying it has roughly a 30% chance of paying in full.
          </Question>
          <Question ask="Do I have to wait for the result to get my tokens back?">
            Not if you hold a full set. Claims that together cover every result can be merged back
            into the collateral at any time. A single claim on its own has to be sold or held until
            the result.
          </Question>
          <Question ask="Can the payouts ever exceed the locked tokens?">
            No. Splitting and merging move the same number of shares in and out, and redemption
            always rounds down to the smallest unit. A tiny remainder can stay locked; it can never
            go the other way.
          </Question>
          <Question ask="What does it not do?">
            It has no order book or price discovery, it does not check that a resolver is honest,
            and holdings are not private.
          </Question>
        </Section>

        <Section id="demo">
          <p>
            The Composer is a calculator. It works out the asset ID, the shares a deposit gives you,
            the effect of splits and merges, and the payouts, all in your browser and with the same
            rules as the on-chain program. It does not send transactions.
          </p>
          <p>
            The wallet button connects to Solana devnet so that real deposits and redemptions can be
            added as the program gains them.
          </p>
        </Section>
      </div>
    </div>
  );
}
