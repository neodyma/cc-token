import {
  Background,
  Controls,
  Handle,
  MiniMap,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeChange,
  type NodeProps,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Edge, GraphLayout } from "./ledger.ts";

export type GraphNode = Readonly<{
  key: string;
  // Small line above the title, such as the claim this one was narrowed from.
  context: string;
  title: string;
  amount: string;
  detail?: string;
  empty: boolean;
  highlight?: string;
  // Set once the position's payout is known.
  tone?: "win" | "lose";
  // The wallet the positions hang from, drawn differently from a position.
  wallet?: boolean;
}>;

type PositionFlowNode = Node<{ node: GraphNode; chosen: boolean; toolbar: ReactNode }, "position">;

const NODE_WIDTH = 196;
const NODE_HEIGHT = 96;
const COLUMN_WIDTH = 220;
const ROW_HEIGHT = 156;

const NODE_TYPES = { position: PositionBox };

export function PositionGraph(props: {
  nodes: readonly GraphNode[];
  edges: readonly Edge[];
  layout: GraphLayout;
  selectedKey: string;
  // Actions for the selected node, shown just under it.
  toolbar: ReactNode;
  onSelect: (key: string) => void;
}) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}

function Flow(props: {
  nodes: readonly GraphNode[];
  edges: readonly Edge[];
  layout: GraphLayout;
  selectedKey: string;
  // Actions for the selected node, shown just under it.
  toolbar: ReactNode;
  onSelect: (key: string) => void;
}) {
  const { slots } = props.layout;
  const { fitView } = useReactFlow();
  // How far boxes were dragged from where the automatic layout puts them. A box that was not
  // dragged follows the one above it, so a moved box keeps its children, old and new, under it.
  const [moved, setMoved] = useState<ReadonlyMap<string, XYPosition>>(new Map());
  const positions = useMemo(() => {
    const parents = new Map<string, string>();
    for (const edge of props.edges) if (!parents.has(edge.to)) parents.set(edge.to, edge.from);
    const offsets = new Map<string, XYPosition>();
    const offsetOf = (key: string): XYPosition => {
      const known = offsets.get(key);
      if (known) return known;
      // Set before recursing so that a malformed, circular graph cannot loop.
      offsets.set(key, { x: 0, y: 0 });
      const parent = parents.get(key);
      const offset = moved.get(key) ?? (parent === undefined ? { x: 0, y: 0 } : offsetOf(parent));
      offsets.set(key, offset);
      return offset;
    };
    const placed = new Map<string, Readonly<{ slot: XYPosition; position: XYPosition }>>();
    for (const [key, { column, depth }] of slots) {
      const slot = { x: column * COLUMN_WIDTH, y: depth * ROW_HEIGHT };
      const offset = offsetOf(key);
      placed.set(key, { slot, position: { x: slot.x + offset.x, y: slot.y + offset.y } });
    }
    return placed;
  }, [slots, props.edges, moved]);

  const nodes = useMemo<PositionFlowNode[]>(
    () =>
      props.nodes
        .filter((node) => slots.has(node.key))
        .map((node) => {
          return {
            id: node.key,
            type: "position",
            position: positions.get(node.key)!.position,
            data: {
              node,
              chosen: node.key === props.selectedKey,
              toolbar: node.key === props.selectedKey ? props.toolbar : null,
            },
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
          };
        }),
    [props.nodes, slots, props.selectedKey, props.toolbar, positions],
  );

  function onNodesChange(changes: readonly NodeChange<PositionFlowNode>[]) {
    const dragged = changes.flatMap((change) => {
      const slot = positions.get(change.type === "position" ? change.id : "")?.slot;
      return change.type === "position" && change.position && slot
        ? [[change.id, { x: change.position.x - slot.x, y: change.position.y - slot.y }] as const]
        : [];
    });
    if (dragged.length > 0) setMoved((current) => new Map([...current, ...dragged]));
  }

  function tidy() {
    setMoved(new Map());
    requestAnimationFrame(() => fitView({ padding: 0.12, maxZoom: 1, duration: 250 }));
  }
  const edges = useMemo(
    () =>
      props.edges
        .filter((edge) => slots.has(edge.from) && slots.has(edge.to))
        .map((edge) => ({
          id: `${edge.from}:${edge.to}`,
          source: edge.from,
          target: edge.to,
          selectable: false,
        })),
    [props.edges, slots],
  );

  // Bring the whole graph back into view whenever its shape changes.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      fitView({ padding: 0.12, maxZoom: 1, duration: 250 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [fitView, slots]);

  return (
    <div className="h-[calc(100vh-17rem)] min-h-[26rem] overflow-hidden rounded-lg border border-line">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        colorMode="system"
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.5}
        nodeDragThreshold={4}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        onNodeClick={(_, node) => props.onSelect(node.id)}
      >
        <Background gap={16} />
        {moved.size > 0 && (
          <Panel position="top-right">
            <button
              type="button"
              onClick={tidy}
              className="rounded-md border border-line bg-panel px-2.5 py-1 text-xs text-muted shadow-sm hover:border-accent hover:text-accent"
            >
              Tidy layout
            </button>
          </Panel>
        )}
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable style={{ width: 120, height: 80 }} />
      </ReactFlow>
    </div>
  );
}

function PositionBox({ data, positionAbsoluteX, positionAbsoluteY }: NodeProps<PositionFlowNode>) {
  const { node, chosen, toolbar } = data;
  const { getZoom, setCenter } = useReactFlow();
  const actions = useRef<HTMLDivElement>(null);
  const shown = chosen && toolbar !== null;

  // When the actions open into a form, move the view so the form is not cut off.
  useEffect(() => {
    const element = actions.current;
    if (!shown || !element) return;
    const observer = new ResizeObserver(() => {
      if (element.offsetHeight < 80) return;
      const zoom = getZoom();
      setCenter(
        positionAbsoluteX + NODE_WIDTH / 2,
        positionAbsoluteY + NODE_HEIGHT + element.offsetHeight / zoom / 2,
        { zoom, duration: 250 },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown, getZoom, setCenter, positionAbsoluteX, positionAbsoluteY]);
  return (
    <button
      type="button"
      aria-pressed={chosen}
      title={node.title}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={`flex cursor-pointer flex-col rounded-lg border px-3 py-2 text-left shadow-sm transition-colors ${
        node.tone === "win"
          ? "bg-good-soft"
          : node.tone === "lose"
            ? "bg-bad-soft"
            : node.wallet
              ? "bg-accent-soft"
              : "bg-panel"
      } ${
        chosen
          ? "border-accent ring-2 ring-accent"
          : node.tone === "win"
            ? "border-good"
            : node.tone === "lose"
              ? "border-bad"
              : node.wallet
                ? "border-accent/50 hover:border-accent"
                : node.empty
                  ? "border-dashed border-line hover:border-muted"
                  : "border-line hover:border-muted"
      }`}
    >
      <Handle type="target" position={Position.Top} className="graph-handle" />
      <span className="flex items-baseline justify-between gap-2 text-[11px]">
        <span
          className={`flex min-w-0 items-center gap-1 ${node.wallet ? "text-accent" : "text-muted"}`}
        >
          {node.wallet && (
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-3 shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
            >
              <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
              <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
            </svg>
          )}
          <span className="truncate">{node.context}</span>
        </span>
        {node.highlight && (
          <span
            className={`shrink-0 font-semibold ${
              node.tone === "win" ? "text-good" : node.tone === "lose" ? "text-bad" : "text-accent"
            }`}
          >
            {node.highlight}
          </span>
        )}
      </span>
      <span
        className={`line-clamp-2 text-sm leading-tight font-medium ${node.empty ? "text-muted" : ""}`}
      >
        {node.title}
      </span>
      <span className="mt-auto flex items-baseline justify-between gap-2 font-mono text-xs">
        <span className={node.empty ? "text-muted" : ""}>{node.amount}</span>
        {node.detail && (
          <span
            className={
              node.tone === "win"
                ? "font-semibold text-good"
                : node.tone === "lose"
                  ? "text-bad"
                  : "text-muted"
            }
          >
            {node.detail}
          </span>
        )}
      </span>
      <Handle type="source" position={Position.Bottom} className="graph-handle" />
      <NodeToolbar isVisible={shown} position={Position.Bottom} offset={6}>
        <div ref={actions}>{toolbar}</div>
      </NodeToolbar>
    </button>
  );
}
