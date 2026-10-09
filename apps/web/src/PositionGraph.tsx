import {
  Background,
  Controls,
  Handle,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

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

  const nodes = useMemo<PositionFlowNode[]>(
    () =>
      props.nodes
        .filter((node) => slots.has(node.key))
        .map((node) => {
          const slot = slots.get(node.key)!;
          return {
            id: node.key,
            type: "position",
            position: { x: slot.column * COLUMN_WIDTH, y: slot.depth * ROW_HEIGHT },
            data: {
              node,
              chosen: node.key === props.selectedKey,
              toolbar: node.key === props.selectedKey ? props.toolbar : null,
            },
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
          };
        }),
    [props.nodes, slots, props.selectedKey, props.toolbar],
  );
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
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        preventScrolling={false}
        onNodeClick={(_, node) => props.onSelect(node.id)}
      >
        <Background gap={16} />
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
        node.tone === "win" ? "bg-good-soft" : node.tone === "lose" ? "bg-bad-soft" : "bg-panel"
      } ${
        chosen
          ? "border-accent ring-2 ring-accent"
          : node.tone === "win"
            ? "border-good"
            : node.tone === "lose"
              ? "border-bad"
              : node.empty
                ? "border-dashed border-line hover:border-muted"
                : "border-line hover:border-muted"
      }`}
    >
      <Handle type="target" position={Position.Top} className="graph-handle" />
      <span className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="truncate text-muted">{node.context}</span>
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
