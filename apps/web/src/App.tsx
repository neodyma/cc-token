import { useMemo, useRef, useState, useSyncExternalStore } from "react";

import { Badge, Chip, Identifier, Panel } from "./components.tsx";
import { HowItWorks } from "./HowItWorks.tsx";
import { DepositFlow, describeClaim } from "./DepositFlow.tsx";
import {
  attempt,
  compose,
  describeSubset,
  findCondition,
  indexSetFromOutcomes,
  outcomesInIndexSet,
  SCENARIOS,
  toHex,
  type Composition,
  type CompositionMode,
  type ConstructionPath,
  type DemoCondition,
  type Scenario,
} from "./scenario.ts";
import { WalletBar } from "./Wallet.tsx";

const DOCS_HASH = "#/how-it-works";

type Row = Readonly<{ id: number; conditionKey: string; outcomes: readonly number[] }>;

function initialRows(scenario: Scenario): readonly Row[] {
  const rows: Row[] = scenario.factors.map((factor, id) => ({
    id,
    conditionKey: factor.conditionKey,
    outcomes: outcomesInIndexSet(
      factor.indexSet,
      scenario.conditions.find((condition) => condition.key === factor.conditionKey)!.outcomes
        .length,
    ),
  }));
  for (const condition of scenario.conditions) {
    if (!rows.some((row) => row.conditionKey === condition.key)) {
      rows.push({ id: rows.length, conditionKey: condition.key, outcomes: [] });
    }
  }
  return rows;
}

function explainError(message: string): string {
  if (message.includes("logical conjunction is empty")) {
    return "Two selections on the same question do not overlap, so no result could satisfy both. Change one of them, or switch the mode to Explicit product to keep both.";
  }
  return message;
}

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
  const showDocs = useHash() === DOCS_HASH;
  const [scenarioKey, setScenarioKey] = useState(SCENARIOS[0]!.key);
  const scenario = SCENARIOS.find((candidate) => candidate.key === scenarioKey)!;

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-panel/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <a href="#/" className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-md bg-accent font-mono text-sm font-bold text-panel">
              cc
            </span>
            <span className="font-semibold">cc-token</span>
            <span className="hidden text-muted sm:inline">Scenario Composer</span>
          </a>
          <nav className="flex gap-1">
            <NavLink href="#/" active={!showDocs}>
              Composer
            </NavLink>
            <NavLink href={DOCS_HASH} active={showDocs}>
              How it works
            </NavLink>
          </nav>
          <div className="ml-auto">
            <WalletBar />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {showDocs ? (
          <HowItWorks />
        ) : (
          <>
            <Intro />
            <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
              <div className="lg:sticky lg:top-20">
                <ScenarioPicker scenario={scenario} onSelect={setScenarioKey} />
              </div>
              <Composer key={scenario.key} scenario={scenario} />
            </div>
          </>
        )}
      </main>
    </>
  );
}

function Intro() {
  return (
    <section className="mb-8 max-w-4xl">
      <h1 className="text-3xl font-semibold tracking-tight">
        Lock tokens, get shares that pay depending on how real-world questions turn out.
      </h1>
      <p className="mt-3 text-lg text-muted">
        Choose the results you want to be paid on, then follow a deposit: the shares it gives you,
        how they split and merge, and what they pay once the results are known. This page is a
        calculator and sends nothing to a blockchain. New to the idea? Start with{" "}
        <a href={DOCS_HASH} className="text-accent underline">
          How it works
        </a>
        .
      </p>
    </section>
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

function ScenarioPicker(props: { scenario: Scenario; onSelect: (key: string) => void }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="text-sm font-semibold tracking-wide uppercase">Scenario</h2>
      <div className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:flex-nowrap lg:gap-1">
        {SCENARIOS.map((candidate) => {
          const active = candidate.key === props.scenario.key;
          return (
            <button
              key={candidate.key}
              type="button"
              aria-pressed={active}
              onClick={() => props.onSelect(candidate.key)}
              className={`rounded-md px-3 py-1.5 text-left text-sm ${
                active ? "bg-accent-soft font-medium text-accent" : "hover:bg-page"
              }`}
            >
              {candidate.title}
            </button>
          );
        })}
      </div>
      <p className="mt-4 border-t border-line pt-4 text-sm">{props.scenario.summary}</p>
      <p className="mt-3 text-sm text-muted">
        <span className="font-medium text-ink">Try this: </span>
        {props.scenario.lookFor}
      </p>
    </section>
  );
}

function Composer(props: { scenario: Scenario }) {
  const { conditions, collateral } = props.scenario;
  const [rows, setRows] = useState<readonly Row[]>(() => initialRows(props.scenario));
  const [mode, setMode] = useState<CompositionMode>(props.scenario.mode);
  const nextId = useRef(rows.length);

  const outcomeCount = (conditionKey: string) =>
    conditions.find((condition) => condition.key === conditionKey)!.outcomes.length;
  // An empty row is ignored and a row with every outcome restricts nothing.
  const activeRows = rows.filter(
    (row) => row.outcomes.length > 0 && row.outcomes.length < outcomeCount(row.conditionKey),
  );
  const repeated = conditions.some(
    (condition) => activeRows.filter((row) => row.conditionKey === condition.key).length > 1,
  );

  const composition = useMemo(
    () =>
      attempt(() =>
        compose(
          conditions,
          activeRows.map((row) => ({
            conditionKey: row.conditionKey,
            indexSet: indexSetFromOutcomes(row.outcomes),
          })),
          mode,
          collateral.mint,
        ),
      ),
    [conditions, rows, mode, collateral],
  );

  function toggleOutcome(rowId: number, outcome: number) {
    setRows((current) =>
      current.map((row) =>
        row.id !== rowId
          ? row
          : {
              ...row,
              outcomes: row.outcomes.includes(outcome)
                ? row.outcomes.filter((candidate) => candidate !== outcome)
                : [...row.outcomes, outcome].sort((left, right) => left - right),
            },
      ),
    );
  }

  let panel = 0;
  const numbered = (title: string) => `${(panel += 1)}. ${title}`;

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title={numbered("Choose what the claim pays on")}
        hint="Each question has a fixed list of possible results. Select the results you want to be paid on. Selecting several means any one of them counts; using several questions means all of them must go your way."
      >
        <div className="flex flex-col gap-6">
          {conditions.map((condition) => {
            const conditionRows = rows.filter((row) => row.conditionKey === condition.key);
            return (
              <div key={condition.key}>
                <div className="font-medium">{condition.title}</div>
                <div className="text-sm text-muted">{condition.question}</div>
                {conditionRows.map((row) => (
                  <div key={row.id} className="mt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {condition.outcomes.map((label, outcome) => (
                        <Chip
                          key={label}
                          selected={row.outcomes.includes(outcome)}
                          onClick={() => toggleOutcome(row.id, outcome)}
                        >
                          {label}
                        </Chip>
                      ))}
                      {conditionRows.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setRows((current) => current.filter((other) => other.id !== row.id))
                          }
                          className="text-sm text-muted hover:text-bad"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {row.outcomes.length === 0 && (
                      <p className="mt-1 text-sm text-muted">
                        Nothing selected, so this question does not affect the claim.
                      </p>
                    )}
                    {row.outcomes.length === condition.outcomes.length && (
                      <p className="mt-1 text-sm text-muted">
                        Every result is selected, so this adds no restriction.
                      </p>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const id = nextId.current;
                    nextId.current += 1;
                    setRows((current) => [
                      ...current,
                      { id, conditionKey: condition.key, outcomes: [] },
                    ]);
                  }}
                  className="mt-3 text-sm text-accent underline"
                >
                  Add another selection on this question
                </button>
              </div>
            );
          })}
        </div>

        {repeated && (
          <div className="mt-6 border-t border-line pt-4">
            <div className="mb-2 text-sm text-muted">
              One question is used more than once. How should its selections combine?
            </div>
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
        )}

        {!composition.ok && (
          <p className="mt-5 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
            {explainError(composition.error)}
          </p>
        )}
      </Panel>

      {composition.ok && (
        <>
          <ClaimIdentity
            title={numbered("The claim you built")}
            scenario={props.scenario}
            composition={composition.value}
          />
          {distinctOrders(composition.value) && (
            <ConstructionOrders
              title={numbered("Building it in another order gives the same asset")}
              conditions={conditions}
              composition={composition.value}
            />
          )}
          <DepositFlow
            firstNumber={panel + 1}
            scenario={props.scenario}
            composition={composition.value}
          />
        </>
      )}
    </div>
  );
}

// Two routes are only worth comparing when they start from different factors.
function distinctOrders(composition: Composition): boolean {
  const [forward, reverse] = composition.paths;
  return (
    forward.steps.length > 1 &&
    toHex(forward.steps[0]!.collectionId) !== toHex(reverse.steps[0]!.collectionId)
  );
}

function ModeToggle(props: { mode: CompositionMode; onChange: (mode: CompositionMode) => void }) {
  const options: readonly { mode: CompositionMode; label: string; hint: string }[] = [
    {
      mode: "logical",
      label: "Logical AND",
      hint: "Only the results common to all selections count, as if you had made one narrower selection.",
    },
    {
      mode: "product",
      label: "Explicit product",
      hint: "Each selection is applied separately, so repeating one multiplies its payout share by itself.",
    },
  ];
  return (
    <div>
      <div className="inline-flex rounded-lg border border-line p-0.5">
        {options.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={props.mode === option.mode}
            onClick={() => props.onChange(option.mode)}
            className={`rounded-md px-3 py-1 text-sm ${
              props.mode === option.mode ? "bg-accent-soft text-accent" : "text-muted"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">
        {options.find((option) => option.mode === props.mode)!.hint}
      </p>
    </div>
  );
}

function ClaimIdentity(props: { title: string; scenario: Scenario; composition: Composition }) {
  const { conditions, collateral } = props.scenario;
  const { plan, positionId } = props.composition;
  if (positionId === null) {
    return (
      <Panel title={props.title}>
        <p className="text-sm text-muted">
          Nothing is restricted yet, so this is just plain {collateral.symbol}. Select some results
          above to turn it into a claim.
        </p>
      </Panel>
    );
  }
  return (
    <Panel
      title={props.title}
      hint={`In words, your shares pay ${collateral.symbol} when the statement below is true. Everyone who makes the same choices over ${collateral.symbol} gets the same asset ID, so their shares and yours are interchangeable.`}
    >
      <p className="mb-4 text-lg">{describeClaim(conditions, plan.factors)}</p>
      <Identifier label="Asset ID (position ID)" value={toHex(positionId)} />
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-muted">
          Show the identifiers it is built from
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <Identifier
            label="Collection ID: the same choices, before a collateral token is fixed"
            value={toHex(plan.collectionId)}
          />
          {[...new Set(plan.factors.map((factor) => toHex(factor.conditionId)))].map((id) => (
            <Identifier
              key={id}
              label={`Condition ID: ${conditions.find((condition) => toHex(condition.conditionId) === id)!.title}`}
              value={id}
            />
          ))}
        </div>
      </details>
    </Panel>
  );
}

function ConstructionOrders(props: {
  title: string;
  conditions: readonly DemoCondition[];
  composition: Composition;
}) {
  const [forward, reverse] = props.composition.paths;
  const same = toHex(forward.collectionId) === toHex(reverse.collectionId);
  return (
    <Panel
      title={props.title}
      hint="One person starts from the first question, another from the second. The halfway points differ, but both finish on the same ID, so they hold the same asset and can trade it with each other."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <PathColumn conditions={props.conditions} path={forward} />
        <PathColumn conditions={props.conditions} path={reverse} />
      </div>
      <div className="mt-4">
        <Badge tone={same ? "good" : "bad"}>
          {same ? "Both orders finish on the same ID" : "The IDs differ"}
        </Badge>
      </div>
    </Panel>
  );
}

function PathColumn(props: { conditions: readonly DemoCondition[]; path: ConstructionPath }) {
  return (
    <ol className="flex flex-col gap-2">
      {props.path.steps.map((step, index) => (
        <li key={index} className="rounded-lg border border-line px-3 py-2">
          <div className="text-sm">
            <span className="text-muted">{index + 1}. add </span>
            {describeSubset(
              findCondition(props.conditions, step.clause.conditionId),
              step.clause.indexSet,
            )}
          </div>
          <div className="truncate font-mono text-xs text-muted" title={toHex(step.collectionId)}>
            {toHex(step.collectionId)}
          </div>
        </li>
      ))}
    </ol>
  );
}
