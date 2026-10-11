import {
  classifyScenarioParticipation,
  fetchAllVerifiedScenarios,
  fetchVerifiedScenario,
  type ConditionClause,
  type ScenarioParticipation,
  type VerifiedScenario,
} from "@cc-token/sdk";
import { address, type Address, type ReadonlyUint8Array } from "@solana/kit";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Panel } from "../components.tsx";
import { describeError } from "../errors.ts";
import { COLLATERAL_KEY, layoutGraph, withPositionPath } from "../ledger.ts";
import type { ScenarioEntry } from "../LiveWorkspace.tsx";
import { PositionGraph, type GraphNode } from "../PositionGraph.tsx";
import { liveScenarioRoute, ROUTES } from "../routes.ts";
import { boxLabel, toHex, type DemoCondition } from "../scenario.ts";
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
          fetchTokenLabels(client.rpc, mints).catch(() => new Map<Address, TokenLabel>()),
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
        if (current) setProblem(describeError(error));
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
            ? problem
              ? "Scenarios temporarily unavailable"
              : "Reading scenarios from devnet…"
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// With a wallet, `workspace` draws the scenario as a graph to act on. Without one, the same
// path is still visible as a read-only graph.
export function LiveScenarioDetail(props: {
  addressText: string;
  owner?: Address;
  workspace?: (entry: ScenarioEntry) => ReactNode;
}) {
  const graphed = props.workspace !== undefined;
  const [renaming, setRenaming] = useState(false);
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
        // The graph reads the wording itself, so it is not asked for twice.
        const recovered = await Promise.all(
          (graphed ? [] : conditionAccounts).map(async (condition) => {
            const chainCondition: ChainCondition = {
              conditionId: Uint8Array.from(condition.data.conditionId),
              questionId: Uint8Array.from(condition.data.questionId),
              resolver: condition.data.resolver,
              outcomeCount: condition.data.outcomeCount,
              payouts: null,
            };
            return [
              toHex(condition.data.conditionId),
              await recoverQuestion(client.rpc, chainCondition).catch(() => null),
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
        // The graph reads the wallet's positions itself.
        if (props.owner && !graphed) {
          const positions = await fetchPositions(
            client.rpc,
            props.owner,
            scenario.anchor.position.data.collateralMint,
          ).then(
            (held) => held.positions,
            () => [],
          );
          for (const position of positions) {
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
        ]).catch(() => new Map<Address, TokenLabel>());
        if (current) {
          setDetail({
            scenario,
            participation,
            label: labels.get(scenario.anchor.position.data.collateralMint) ?? null,
            names,
          });
        }
      } catch (error) {
        if (current) setProblem(describeError(error));
      }
    })();
    return () => {
      current = false;
    };
  }, [props.addressText, props.owner, graphed, reload]);

  const scenarioName = detail?.scenario.definition.data.name;
  const anchor = detail?.scenario.anchor;
  const entry = useMemo<ScenarioEntry | null>(
    () =>
      scenarioName === undefined || anchor === undefined
        ? null
        : {
            name: scenarioName,
            mint: anchor.position.data.collateralMint,
            path: anchor.collection.factors.map(({ conditionId, outcomeCount, indexSet }) => ({
              conditionId: Uint8Array.from(conditionId),
              outcomeCount,
              indexSet,
            })),
          },
    [scenarioName, anchor],
  );

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
      {graphed ? (
        // The graph below shows the collateral and the holdings, so one line is enough here.
        <div className="rounded-lg border border-line bg-panel px-4 py-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-base font-semibold">{scenario.definition.data.name}</h1>
            <span className="text-muted capitalize">{scenario.state.replace("_", " ")}</span>
            <span className="text-muted" title={scenario.definition.data.creator}>
              by{" "}
              <span className="font-mono text-xs">{shorten(scenario.definition.data.creator)}</span>
            </span>
            {props.owner === scenario.definition.data.creator && (
              <button
                type="button"
                onClick={() => setRenaming((value) => !value)}
                className="ml-auto text-accent underline"
              >
                {renaming ? "Cancel" : "Rename"}
              </button>
            )}
          </div>
          {renaming && (
            <RenameScenario
              current={scenario.definition.data.name}
              anchorPositionId={scenario.definition.data.anchorPositionId}
              onRenamed={() => {
                setRenaming(false);
                setReload((value) => value + 1);
              }}
            />
          )}
        </div>
      ) : (
        <Panel title={scenario.definition.data.name}>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Datum label="State" value={scenario.state.replace("_", " ")} />
            <Datum
              label="Collateral"
              value={
                label?.symbol ||
                label?.name ||
                shorten(scenario.anchor.position.data.collateralMint)
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
      )}
      {props.workspace && entry ? (
        props.workspace(entry)
      ) : (
        <Panel
          title="Featured claim path"
          hint="The anchor names one complete path through the scenario. Other compatible claims are derived from the same condition basis when needed."
        >
          <ScenarioPreview scenario={scenario} label={label} names={names} />
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <a href={ROUTES.live} className="text-accent underline">
              Back to scenarios
            </a>
            {!props.owner && (
              <span className="text-muted">
                Connect a wallet to open this scenario as a graph and take the position.
              </span>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

function ScenarioPreview(props: {
  scenario: VerifiedScenario;
  label: TokenLabel | null;
  names: ReadonlyMap<string, Readonly<{ title: string; outcomes: readonly string[] }>>;
}) {
  const factors: ConditionClause[] = props.scenario.anchor.collection.factors.map(
    ({ conditionId, outcomeCount, indexSet }) => ({
      conditionId: Uint8Array.from(conditionId),
      outcomeCount,
      indexSet,
    }),
  );
  const conditions: DemoCondition[] = [
    ...new Map(
      props.scenario.anchor.collection.factors.map(({ conditionId, condition }) => {
        const key = toHex(conditionId);
        const named = props.names.get(key);
        const title = named?.title ?? `Question ${shorten(key)}`;
        return [
          key,
          {
            key,
            title,
            question: title,
            outcomes:
              named?.outcomes ??
              Array.from(
                { length: condition.data.outcomeCount },
                (_, index) => `Outcome ${index + 1}`,
              ),
            resolver: condition.data.resolver,
            questionId: Uint8Array.from(condition.data.questionId),
            conditionId: Uint8Array.from(conditionId),
          },
        ] as const;
      }),
    ).values(),
  ];
  const ledger = withPositionPath(
    { portfolio: { collateral: 0n, holdings: [] }, nodes: [], edges: [] },
    factors,
  );
  const symbol = props.label?.symbol || props.label?.name || "collateral";
  const nodes: GraphNode[] = [
    {
      key: COLLATERAL_KEY,
      context: "Collateral",
      title: symbol,
      amount: "",
      empty: true,
    },
    ...ledger.nodes.map((node) => ({
      key: node.key,
      ...boxLabel(conditions, node.factors),
      amount: "0 shares",
      empty: true,
    })),
  ];
  return (
    <PositionGraph
      nodes={nodes}
      edges={ledger.edges}
      layout={layoutGraph(ledger)}
      selectedKey=""
      toolbar={null}
      onSelect={() => {}}
    />
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
            setProblem(describeError(error));
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
