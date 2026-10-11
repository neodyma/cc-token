import { validateScenarioName, type ConditionClause } from "@cc-token/sdk";
import type { Address, Signature } from "@solana/kit";
import { useEffect, useRef, useState } from "react";

import { describeError } from "../errors.ts";
import { transactionLinks } from "../LiveWorkspace.tsx";
import { liveScenarioRoute } from "../routes.ts";
import { attempt, indexSetFromOutcomes, parseTokenAmount } from "../scenario.ts";
import { client } from "../solana.ts";
import { showToast } from "../toast.tsx";
import {
  createTestCollateral,
  prepareQuestion,
  publishScenario,
  registerCollateral,
  TEST_TOKEN_NAME,
  TOKEN_NAME_BYTES,
  TOKEN_SYMBOL_BYTES,
  tokenLabelProblem,
} from "./chain.ts";
import {
  fetchCollateral,
  fetchConditions,
  fetchHeldCollaterals,
  fetchTokenLabels,
  type TokenLabel,
} from "./discovery.ts";
import {
  loadQuestions,
  newQuestion,
  questionMemo,
  saveQuestions,
  toCondition,
  type StoredQuestion,
} from "./questions.ts";

const NEW = "new";
// The prefix of an example's value in the question selector.
const EXAMPLE = "example:";

type TokenOption = Readonly<{ mint: Address; label: TokenLabel | null }>;

// One question of the scenario and the results its featured position pays on.
type Draft = Readonly<{
  id: string;
  // NEW, or the key of a question that is already on-chain.
  source: string;
  title: string;
  outcomes: string;
  picked: readonly number[];
}>;

type Step = Readonly<{ label: string; state: "waiting" | "running" | "done" }>;

function shorten(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function parseOutcomes(text: string): readonly string[] {
  return text
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label !== "");
}

const emptyDraft = (): Draft => ({
  id: crypto.randomUUID(),
  source: NEW,
  title: "",
  outcomes: "",
  picked: [0],
});

// Everything a new scenario needs, in one place: the token that backs it, its questions, the
// position it features and its name. Each part that is not on-chain yet is one transaction.
export function CreateScenario(props: {
  owner: Address;
  // Where the questions this browser has named are kept, and its last opened token.
  questionsKey: string;
  mintKey: string;
  testToken: Readonly<{ decimals: number; grant: string }>;
  examples: readonly Readonly<{ title: string; outcomes: readonly string[] }>[];
  onClose: () => void;
}) {
  const { owner, questionsKey, mintKey } = props;
  const [tokens, setTokens] = useState<readonly TokenOption[]>([]);
  const [token, setToken] = useState<string>(NEW);
  const [tokenName, setTokenName] = useState<string>(TEST_TOKEN_NAME.name);
  const [tokenSymbol, setTokenSymbol] = useState<string>(TEST_TOKEN_NAME.symbol);
  const [known, setKnown] = useState<readonly StoredQuestion[]>([]);
  const [drafts, setDrafts] = useState<readonly Draft[]>(() => [emptyDraft()]);
  // The question being edited. The others are folded to one line each.
  const [open, setOpen] = useState<string | null>(() => null);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [steps, setSteps] = useState<readonly Step[] | null>(null);
  const busy = steps !== null && steps.some((step) => step.state === "running");

  // What an attempt already put on-chain, so that trying again does not repeat it.
  const createdMint = useRef<Address | null>(null);
  const prepared = useRef(new Map<string, StoredQuestion>());
  const pressedBackdrop = useRef(false);

  // The tokens this wallet has used, and the questions this browser named that exist.
  useEffect(() => {
    let current = true;
    void (async () => {
      const stored = localStorage.getItem(mintKey) as Address | null;
      const held = await fetchHeldCollaterals(client.rpc, owner).then(
        (found) => found.collaterals,
        () => [],
      );
      const options: TokenOption[] = held.map(({ mint, label }) => ({ mint, label }));
      if (stored && !options.some((option) => option.mint === stored)) {
        const labels = await fetchTokenLabels(client.rpc, [stored]).catch(() => null);
        options.unshift({ mint: stored, label: labels?.get(stored) ?? null });
      }
      if (!current) return;
      setTokens(options);
      if (stored) setToken(stored);
    })();
    void (async () => {
      const questions = loadQuestions(localStorage, questionsKey);
      const onChain = await fetchConditions(
        client.rpc,
        questions.map((question) => toCondition(question).conditionId),
      ).catch(() => null);
      if (current && onChain) {
        setKnown(questions.filter((question) => onChain.has(toCondition(question).key)));
      }
    })();
    return () => {
      current = false;
    };
  }, [owner, mintKey, questionsKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const update = (id: string, next: Partial<Omit<Draft, "id">>) =>
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...next } : draft)),
    );
  const knownByKey = new Map(known.map((question) => [toCondition(question).key, question]));
  const outcomesOf = (draft: Draft): readonly string[] =>
    draft.source === NEW
      ? parseOutcomes(draft.outcomes)
      : (knownByKey.get(draft.source)?.outcomes ?? []);

  // Why the form cannot be sent yet, or null.
  function invalid(): string | null {
    if (!attempt(() => validateScenarioName(name.trim())).ok) {
      return "Give the scenario a name of 1 to 64 bytes.";
    }
    if (token === NEW) {
      const label = tokenLabelProblem({ name: tokenName.trim(), symbol: tokenSymbol.trim() });
      if (label) return label;
    }
    const used = drafts.filter((draft) => draft.source !== NEW).map((draft) => draft.source);
    if (new Set(used).size < used.length) {
      return "Use each question once. A position that repeats a question can be published from its box in the graph.";
    }
    for (const [index, draft] of drafts.entries()) {
      const outcomes = outcomesOf(draft);
      const where = `Question ${index + 1}`;
      if (draft.source === NEW) {
        if (draft.title.trim() === "") return `${where} needs a name.`;
        if (outcomes.length < 2) {
          return `${where} needs at least two possible results, separated by commas.`;
        }
        if (new Set(outcomes).size < outcomes.length) {
          return `${where}: each result needs a different name.`;
        }
        if (outcomes.length > 96) return `${where}: this page handles at most 96 results.`;
      }
      const picked = draft.picked.filter((outcome) => outcome < outcomes.length);
      if (picked.length === 0 || picked.length === outcomes.length) {
        return `${where}: tick some of its results, but not all, for the featured position.`;
      }
    }
    return null;
  }

  async function create() {
    const failure = invalid();
    setProblem(failure);
    if (failure) return;

    const fresh = drafts.filter((draft) => draft.source === NEW && !prepared.current.has(draft.id));
    const labels = [
      token === NEW ? "Create the token" : "Check the token",
      ...fresh.map((draft) => `Prepare “${draft.title.trim()}”`),
      "Publish the scenario",
    ];
    const mark = (running: number) =>
      setSteps(
        labels.map((label, index) => ({
          label,
          state: index < running ? "done" : index === running ? "running" : "waiting",
        })),
      );

    let at = 0;
    // One toast per transaction: asking for the approval, then confirming it with a link.
    let asking: number | undefined;
    const sent = async <T,>(
      label: string,
      done: string,
      transaction: () => Promise<T>,
      signaturesOf: (result: T) => readonly Signature[],
    ): Promise<T> => {
      asking = showToast({ tone: "pending", text: `${label}: approve it in your wallet.` });
      const result = await transaction();
      showToast(
        { tone: "good", text: done, links: transactionLinks(signaturesOf(result)) },
        asking,
      );
      asking = undefined;
      return result;
    };
    try {
      mark(at);
      let mint: Address;
      if (token === NEW) {
        if (!createdMint.current) {
          const label = { name: tokenName.trim(), symbol: tokenSymbol.trim() };
          const created = await sent(
            "Creating the token",
            `Created the token “${label.name}” and minted ${props.testToken.grant} ${label.symbol}.`,
            () =>
              createTestCollateral(
                client,
                parseTokenAmount(props.testToken.grant, props.testToken.decimals),
                props.testToken.decimals,
                label,
              ),
            (result) => result.signatures,
          );
          createdMint.current = created.mint;
          localStorage.setItem(mintKey, created.mint);
        }
        mint = createdMint.current;
      } else {
        mint = token as Address;
        const collateral = await fetchCollateral(client.rpc, owner, mint);
        if (!collateral.registered) {
          await sent(
            "Registering the token",
            "Registered the token as collateral.",
            () => registerCollateral(client, collateral),
            (signatures) => signatures,
          );
        }
      }

      for (const draft of fresh) {
        at += 1;
        mark(at);
        const outcomes = parseOutcomes(draft.outcomes);
        const question = newQuestion(owner, draft.title.trim(), outcomes, crypto.randomUUID());
        const condition = toCondition(question);
        await sent(
          `Preparing “${question.title}”`,
          `Prepared the question “${question.title}”.`,
          () =>
            prepareQuestion(client, condition.questionId, outcomes.length, questionMemo(question)),
          (signatures) => signatures,
        );
        prepared.current.set(draft.id, question);
        saveQuestions(localStorage, questionsKey, [
          ...loadQuestions(localStorage, questionsKey),
          question,
        ]);
        // The next transaction builds on the question, so wait until a read shows it.
        for (let attempts = 0; attempts < 20; attempts += 1) {
          const seen = await fetchConditions(client.rpc, [condition.conditionId]).catch(() => null);
          if (seen?.has(condition.key)) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      at += 1;
      mark(at);
      const factors: ConditionClause[] = drafts.map((draft) => {
        const question = prepared.current.get(draft.id) ?? knownByKey.get(draft.source)!;
        const condition = toCondition(question);
        return {
          conditionId: condition.conditionId,
          outcomeCount: question.outcomes.length,
          indexSet: indexSetFromOutcomes(
            draft.picked.filter((outcome) => outcome < question.outcomes.length),
          ),
        };
      });
      const published = await sent(
        "Publishing the scenario",
        `Published the scenario “${name.trim()}”.`,
        () => publishScenario(client, mint, name.trim(), factors, "logical"),
        (result) => result.signatures,
      );
      window.location.hash = liveScenarioRoute(published.address);
    } catch (error) {
      // Steps that finished stay finished; sending the form again carries on from here.
      setSteps(labels.map((label, index) => ({ label, state: index < at ? "done" : "waiting" })));
      const message = `${labels[at]} did not go through. ${describeError(error)}`;
      setProblem(message);
      if (asking !== undefined) showToast({ tone: "bad", text: message }, asking);
    }
  }

  // Why a question's ticks cannot be used, or null.
  const tickProblem = (draft: Draft): string | null => {
    const outcomes = outcomesOf(draft);
    const ticked = draft.picked.filter((outcome) => outcome < outcomes.length).length;
    return outcomes.length > 1 && (ticked === 0 || ticked === outcomes.length)
      ? "Tick some of the results, but not all: a position that pays on every result is the same as not asking the question."
      : null;
  };
  const openId = open ?? drafts[0]?.id ?? null;

  const field = "block w-full rounded-md border border-line bg-page px-2 py-1.5";
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4"
      // A click on the backdrop closes the dialog. A drag that starts inside it, as when
      // selecting text, and ends outside is not one.
      onMouseDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget && !busy) {
          props.onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-scenario-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-panel p-5 text-sm shadow-lg [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="create-scenario-title" className="text-lg font-semibold">
              Create a scenario
            </h2>
            <p className="mt-1 text-muted">
              A named position that every wallet finds in the list and can open as a graph.
              Publishing it deposits nothing.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={props.onClose}
            aria-label="Close"
            className="text-muted hover:text-ink disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <fieldset disabled={busy} className="m-0 mt-4 flex min-w-0 flex-col gap-4 border-0 p-0">
          <div className="flex flex-wrap gap-2">
            <label className="min-w-56 flex-1">
              <span className="text-muted">Scenario name</span>
              <input
                value={name}
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Fed cut and SOL above $200"
                className={`mt-1 ${field}`}
              />
            </label>
            <label className="w-52">
              <span className="text-muted">Backed by</span>
              <select
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className={`mt-1 ${field}`}
              >
                <option value={NEW}>A new test token</option>
                {tokens.map(({ mint, label }) => (
                  <option key={mint} value={mint}>
                    {label ? `${label.symbol || label.name} · ` : ""}
                    {shorten(mint)}
                  </option>
                ))}
              </select>
            </label>
            {token === NEW && (
              <div className="flex basis-full flex-wrap gap-2">
                <label className="min-w-48 flex-1">
                  <span className="text-muted">New token's name</span>
                  <input
                    value={tokenName}
                    maxLength={TOKEN_NAME_BYTES}
                    onChange={(event) => setTokenName(event.target.value)}
                    className={`mt-1 ${field}`}
                  />
                </label>
                <label className="w-28">
                  <span className="text-muted">Symbol</span>
                  <input
                    value={tokenSymbol}
                    maxLength={TOKEN_SYMBOL_BYTES}
                    onChange={(event) => setTokenSymbol(event.target.value.toUpperCase())}
                    className={`mt-1 font-mono ${field}`}
                  />
                </label>
              </div>
            )}
          </div>

          <section>
            <h3 className="font-medium">Questions</h3>
            <p className="text-muted">
              Tick the results the featured position pays on. With several questions it pays only
              when a ticked result happens on every one.
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {drafts.map((draft, index) => {
                const outcomes = outcomesOf(draft);
                const reused = knownByKey.get(draft.source);
                const title = reused?.title ?? draft.title.trim();
                const ticked = draft.picked
                  .filter((outcome) => outcome < outcomes.length)
                  .map((outcome) => outcomes[outcome]!);
                const wrong = tickProblem(draft);
                const expanded = draft.id === openId;
                return (
                  <div key={draft.id} className="rounded-lg border border-line">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? "" : draft.id)}
                        className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                      >
                        <span className="text-muted">{expanded ? "▾" : "▸"}</span>
                        <span className="shrink-0 font-medium">
                          {index + 1}. {title || "New question"}
                        </span>
                        {!expanded && (
                          <span className={`truncate ${wrong ? "text-bad" : "text-muted"}`}>
                            {outcomes.length === 0
                              ? "not filled in yet"
                              : wrong
                                ? "needs some results ticked, but not all"
                                : ticked.join(" or ")}
                          </span>
                        )}
                      </button>
                      {drafts.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setDrafts((current) => current.filter((item) => item.id !== draft.id))
                          }
                          className="text-xs text-muted hover:text-bad"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {expanded && (
                      <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
                        <select
                          value={draft.source}
                          onChange={(event) => {
                            const { value } = event.target;
                            const example = value.startsWith(EXAMPLE)
                              ? props.examples[Number(value.slice(EXAMPLE.length))]
                              : undefined;
                            update(
                              draft.id,
                              example
                                ? {
                                    source: NEW,
                                    title: example.title,
                                    outcomes: example.outcomes.join(", "),
                                    picked: [0],
                                  }
                                : { source: value, picked: [0] },
                            );
                          }}
                          aria-label={`Where question ${index + 1} comes from`}
                          className={field}
                        >
                          <option value={NEW}>Write a new question</option>
                          {known.length > 0 && (
                            <optgroup label="Reuse a question that is already on-chain">
                              {known.map((question) => {
                                const key = toCondition(question).key;
                                return (
                                  <option key={key} value={key}>
                                    {question.title} ({question.outcomes.length} results)
                                  </option>
                                );
                              })}
                            </optgroup>
                          )}
                          {props.examples.length > 0 && (
                            <optgroup label="Start a new question from an example">
                              {props.examples.map((example, exampleIndex) => (
                                <option key={exampleIndex} value={`${EXAMPLE}${exampleIndex}`}>
                                  {example.title} ({example.outcomes.length} results)
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        {draft.source === NEW && (
                          <div className="flex flex-wrap gap-2">
                            <input
                              value={draft.title}
                              onChange={(event) => update(draft.id, { title: event.target.value })}
                              placeholder="Question, e.g. Does the Fed cut rates?"
                              aria-label="Question"
                              className={`min-w-48 flex-1 ${field}`}
                            />
                            <input
                              value={draft.outcomes}
                              onChange={(event) =>
                                update(draft.id, { outcomes: event.target.value })
                              }
                              placeholder="Results, comma-separated: cut, no cut"
                              aria-label="Possible results"
                              className={`min-w-48 flex-1 ${field}`}
                            />
                          </div>
                        )}
                        {outcomes.length > 0 && (
                          <div className="flex flex-wrap gap-x-4 gap-y-2">
                            {outcomes.map((outcome, outcomeIndex) => (
                              <label key={outcomeIndex} className="flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={draft.picked.includes(outcomeIndex)}
                                  onChange={(event) =>
                                    update(draft.id, {
                                      picked: event.target.checked
                                        ? [...draft.picked, outcomeIndex].sort((a, b) => a - b)
                                        : draft.picked.filter((value) => value !== outcomeIndex),
                                    })
                                  }
                                />
                                {outcome}
                              </label>
                            ))}
                          </div>
                        )}
                        {wrong && <p className="text-xs text-bad">{wrong}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  const next = emptyDraft();
                  setDrafts((current) => [...current, next]);
                  setOpen(next.id);
                }}
                className="self-start text-accent underline"
              >
                Add another question
              </button>
            </div>
          </section>
        </fieldset>

        <div className="sticky -bottom-5 -mx-5 mt-4 -mb-5 border-t border-line bg-panel px-5 py-3">
          {steps && (
            <ol className="mb-3 flex flex-col gap-1">
              {steps.map((step) => (
                <li
                  key={step.label}
                  className={step.state === "waiting" ? "text-muted" : undefined}
                >
                  {step.state === "done" ? "✓" : step.state === "running" ? "…" : "·"} {step.label}
                  {step.state === "running" && (
                    <span className="text-muted"> — approve it in your wallet</span>
                  )}
                </li>
              ))}
            </ol>
          )}
          {problem && (
            <p className="mb-3 rounded-md bg-bad-soft px-3 py-2 break-words text-bad">{problem}</p>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={props.onClose}
              className="text-muted underline disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void create()}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-panel disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create scenario"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
