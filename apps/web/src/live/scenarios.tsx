import {
  classifyScenarioParticipation,
  fetchAllVerifiedScenarios,
  fetchVerifiedScenario,
  type ScenarioParticipation,
  type VerifiedScenario,
} from "@cc-token/sdk";
import { address, type Address, type ReadonlyUint8Array } from "@solana/kit";
import { useEffect, useState } from "react";

import { Panel } from "../components.tsx";
import { liveScenarioRoute, ROUTES } from "../routes.ts";
import { toHex } from "../scenario.ts";
import { client } from "../solana.ts";
import { renameScenario } from "./chain.ts";
import {
  fetchPositions,
  fetchTokenLabels,
  recoverQuestion,
  type ChainCondition,
  type TokenLabel,
} from "./discovery.ts";

type ScenarioRow = Readonly<{
  scenario: VerifiedScenario;
  participation: ScenarioParticipation;
  label: TokenLabel | null;
}>;

export function LiveScenarioDiscovery(props: { owner?: Address }) {
  const [rows, setRows] = useState<readonly ScenarioRow[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [failureCount, setFailureCount] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    void (async () => {
      setProblem(null);
      try {
        const discovery = await fetchAllVerifiedScenarios(client.rpc);
        const mints = [
          ...new Set(
            discovery.scenarios.map((scenario) => scenario.anchor.position.data.collateralMint),
          ),
        ];
        const [labels, positions] = await Promise.all([
          fetchTokenLabels(client.rpc, mints),
          props.owner
            ? Promise.all(
                mints.map(async (mint) => {
                  try {
                    return [
                      mint,
                      (await fetchPositions(client.rpc, props.owner!, mint)).positions,
                    ] as const;
                  } catch {
                    return [mint, []] as const;
                  }
                }),
              )
            : Promise.resolve([]),
        ]);
        const byMint = new Map(positions);
        const next = discovery.scenarios.map((scenario) => {
          let participation: ScenarioParticipation = "unrelated";
          for (const position of byMint.get(scenario.anchor.position.data.collateralMint) ?? []) {
            if (position.amount === 0n && position.wrapped === 0n) continue;
            const candidate = classifyScenarioParticipation(scenario, {
              collateralMint: scenario.anchor.position.data.collateralMint,
              factors: position.factors,
            });
            if (candidate === "exact") {
              participation = candidate;
              break;
            }
            if (candidate === "compatible") participation = candidate;
          }
          return {
            scenario,
            participation,
            label: labels.get(scenario.anchor.position.data.collateralMint) ?? null,
          };
        });
        next.sort(compareRows);
        if (!current) return;
        setRows(next);
        setFailureCount(discovery.failures.length);
      } catch (error) {
        if (current) setProblem(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      current = false;
    };
  }, [props.owner, reload]);

  return (
    <Panel
      title="Scenarios"
      hint="Published scenario entrypoints are read from the program. Connect a wallet to put scenarios containing your positions first."
    >
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted">
          {rows === null
            ? "Reading scenarios from devnet…"
            : `${rows.length} ${rows.length === 1 ? "scenario" : "scenarios"}`}
          {failureCount > 0 ? ` · ${failureCount} invalid entries hidden` : ""}
        </p>
        <div className="flex gap-3">
          {props.owner && (
            <a href={ROUTES.liveCreate} className="text-accent underline">
              Create a scenario
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              setRows(null);
              setReload((value) => value + 1);
            }}
            className="text-accent underline"
          >
            Refresh
          </button>
        </div>
      </div>
      {problem && (
        <p className="mt-3 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{problem}</p>
      )}
      {rows?.length === 0 && (
        <p className="mt-4 text-sm text-muted">
          No scenarios have been published yet. Existing positions continue to work normally.
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-medium">Scenario</th>
                <th className="py-2 pr-4 font-medium">State</th>
                <th className="py-2 pr-4 font-medium">Collateral</th>
                <th className="py-2 pr-4 font-medium">Questions</th>
                <th className="py-2 pr-4 font-medium">Creator</th>
                <th className="py-2 text-right font-medium">Registered</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ scenario, participation, label }) => (
                <tr
                  key={scenario.definition.address}
                  className="border-b border-line last:border-0"
                >
                  <td className="py-3 pr-4">
                    <a
                      href={liveScenarioRoute(scenario.definition.address)}
                      className="font-medium text-accent hover:underline"
                    >
                      {scenario.definition.data.name}
                    </a>
                    {participation !== "unrelated" && (
                      <div className="mt-1 text-xs text-good">
                        {participation === "exact" ? "Your position" : "Compatible position"}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4 capitalize">{scenario.state.replace("_", " ")}</td>
                  <td
                    className="py-3 pr-4 font-mono text-xs"
                    title={scenario.anchor.position.data.collateralMint}
                  >
                    {label?.symbol ||
                      label?.name ||
                      shorten(scenario.anchor.position.data.collateralMint)}
                  </td>
                  <td className="py-3 pr-4">
                    {scenario.uniqueConditionCount}
                    {scenario.factorCount !== scenario.uniqueConditionCount && (
                      <span className="text-muted"> · {scenario.factorCount} factors</span>
                    )}
                  </td>
                  <td
                    className="py-3 pr-4 font-mono text-xs text-muted"
                    title={scenario.definition.data.creator}
                  >
                    {shorten(scenario.definition.data.creator)}
                  </td>
                  <td className="py-3 text-right font-mono text-xs text-muted">
                    slot {scenario.definition.data.registeredSlot.toString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function LiveScenarioDetail(props: { addressText: string; owner?: Address }) {
  const [detail, setDetail] = useState<Readonly<{
    scenario: VerifiedScenario;
    participation: ScenarioParticipation;
    label: TokenLabel | null;
    names: ReadonlyMap<string, Readonly<{ title: string; outcomes: readonly string[] }>>;
  }> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const scenarioAddress = address(props.addressText);
        const scenario = await fetchVerifiedScenario(client.rpc, scenarioAddress);
        const conditionAccounts = [
          ...new Map(
            scenario.anchor.collection.factors.map((factor) => [
              toHex(factor.conditionId),
              factor.condition,
            ]),
          ).values(),
        ];
        const recovered = await Promise.all(
          conditionAccounts.map(async (condition) => {
            const chainCondition: ChainCondition = {
              conditionId: Uint8Array.from(condition.data.conditionId),
              questionId: Uint8Array.from(condition.data.questionId),
              resolver: condition.data.resolver,
              outcomeCount: condition.data.outcomeCount,
              payouts: null,
            };
            return [
              toHex(condition.data.conditionId),
              await recoverQuestion(client.rpc, chainCondition),
            ] as const;
          }),
        );
        const names = new Map(
          recovered.flatMap(([key, question]) =>
            question
              ? [[key, { title: question.title, outcomes: question.outcomes }] as const]
              : [],
          ),
        );
        let participation: ScenarioParticipation = "unrelated";
        if (props.owner) {
          const held = await fetchPositions(
            client.rpc,
            props.owner,
            scenario.anchor.position.data.collateralMint,
          );
          for (const position of held.positions) {
            if (position.amount === 0n && position.wrapped === 0n) continue;
            const candidate = classifyScenarioParticipation(scenario, {
              collateralMint: scenario.anchor.position.data.collateralMint,
              factors: position.factors,
            });
            if (candidate === "exact") {
              participation = candidate;
              break;
            }
            if (candidate === "compatible") participation = candidate;
          }
        }
        const labels = await fetchTokenLabels(client.rpc, [
          scenario.anchor.position.data.collateralMint,
        ]);
        if (current) {
          setDetail({
            scenario,
            participation,
            label: labels.get(scenario.anchor.position.data.collateralMint) ?? null,
            names,
          });
        }
      } catch (error) {
        if (current) setProblem(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      current = false;
    };
  }, [props.addressText, props.owner, reload]);

  if (problem) {
    return (
      <Panel title="Scenario unavailable">
        <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{problem}</p>
        <a href={ROUTES.live} className="mt-3 inline-block text-sm text-accent underline">
          Back to scenarios
        </a>
      </Panel>
    );
  }
  if (!detail) return <Panel title="Scenario">Reading the scenario from devnet…</Panel>;

  const { scenario, participation, label, names } = detail;
  return (
    <div className="flex flex-col gap-4">
      <Panel title={scenario.definition.data.name}>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Datum label="State" value={scenario.state.replace("_", " ")} />
          <Datum
            label="Collateral"
            value={
              label?.symbol || label?.name || shorten(scenario.anchor.position.data.collateralMint)
            }
            title={scenario.anchor.position.data.collateralMint}
          />
          <Datum
            label="Creator"
            value={shorten(scenario.definition.data.creator)}
            title={scenario.definition.data.creator}
          />
          <Datum
            label="Your holdings"
            value={
              props.owner
                ? participation === "exact"
                  ? "Exact position"
                  : participation === "compatible"
                    ? "Compatible position"
                    : "None"
                : "Connect to check"
            }
          />
        </div>
        {props.owner === scenario.definition.data.creator && (
          <RenameScenario
            current={scenario.definition.data.name}
            anchorPositionId={scenario.definition.data.anchorPositionId}
            onRenamed={() => setReload((value) => value + 1)}
          />
        )}
      </Panel>
      <Panel
        title="Featured claim path"
        hint="The anchor names one complete path through the scenario. Other compatible claims are derived from the same condition basis when needed."
      >
        <ol className="flex flex-col gap-3">
          {scenario.anchor.collection.factors.map((factor, index) => {
            const question = names.get(toHex(factor.conditionId));
            const selected = selectedOutcomes(factor.indexSet, factor.outcomeCount).map(
              (outcome) => question?.outcomes[outcome] ?? `Outcome ${outcome + 1}`,
            );
            return (
              <li
                key={`${toHex(factor.conditionId)}:${index}`}
                className="rounded-lg border border-line p-3"
              >
                <p className="font-medium">
                  {question?.title ?? `Question ${shorten(toHex(factor.conditionId))}`}
                </p>
                <p className="mt-1 text-sm text-muted">{selected.join(" or ")}</p>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <a href={ROUTES.live} className="text-accent underline">
            Back to scenarios
          </a>
          {!props.owner && (
            <span className="text-muted">Connect a wallet to use this scenario.</span>
          )}
        </div>
      </Panel>
    </div>
  );
}

function RenameScenario(props: {
  current: string;
  anchorPositionId: ReadonlyUint8Array;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(props.current);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setProblem(null);
        void renameScenario(client, props.anchorPositionId, name).then(
          () => {
            setBusy(false);
            props.onRenamed();
          },
          (error) => {
            setBusy(false);
            setProblem(error instanceof Error ? error.message : String(error));
          },
        );
      }}
    >
      <label className="min-w-64 flex-1">
        <span className="font-medium">Scenario name</span>
        <input
          value={name}
          maxLength={64}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 block w-full rounded-md border border-line bg-page px-2 py-1.5"
        />
      </label>
      <button
        type="submit"
        disabled={busy || name === props.current}
        className="rounded-md border border-line px-3 py-1.5 hover:border-accent hover:text-accent disabled:opacity-40"
      >
        {busy ? "Saving…" : "Rename"}
      </button>
      {problem && <p className="basis-full text-bad">{problem}</p>}
    </form>
  );
}

function compareRows(left: ScenarioRow, right: ScenarioRow): number {
  const rank = (row: ScenarioRow): number => {
    if (row.scenario.state === "active" && row.participation === "exact") return 0;
    if (row.scenario.state === "active" && row.participation === "compatible") return 1;
    if (row.participation !== "unrelated") return 2;
    if (row.scenario.state === "active") return 3;
    return 4;
  };
  const rankOrder = rank(left) - rank(right);
  if (rankOrder !== 0) return rankOrder;
  const slotOrder = Number(
    right.scenario.definition.data.registeredSlot - left.scenario.definition.data.registeredSlot,
  );
  return (
    slotOrder || left.scenario.definition.address.localeCompare(right.scenario.definition.address)
  );
}

function selectedOutcomes(words: readonly bigint[], outcomeCount: number): readonly number[] {
  return Array.from({ length: outcomeCount }, (_, outcome) => outcome).filter(
    (outcome) => (words[Math.floor(outcome / 64)]! & (1n << BigInt(outcome % 64))) !== 0n,
  );
}

function shorten(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function Datum(props: { label: string; value: string; title?: string }) {
  return (
    <div title={props.title}>
      <p className="text-xs text-muted">{props.label}</p>
      <p className="mt-0.5 capitalize">{props.value}</p>
    </div>
  );
}
