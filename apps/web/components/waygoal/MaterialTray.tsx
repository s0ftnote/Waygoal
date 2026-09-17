"use client";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MATERIAL_SCOPES, type MaterialSnapshot } from "@/lib/waygoal/materials";
import { feedbackIntent, feedbackMotion } from "./feedback-motion";

export type MaterialArrival = { material: MaterialSnapshot; allowed: () => boolean };
const revealedArrivals = new WeakSet<MaterialArrival>();
const identity = (material: MaterialSnapshot) => `${material.sessionId}:${material.turnId}`;
type Exit = { id: number; material: MaterialSnapshot; open: boolean; style: CSSProperties };

function ExitingMaterial({ exit, onDone }: { exit: Exit; onDone: (id: number) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const done = useRef(onDone); done.current = onDone;
  useLayoutEffect(() => {
    let active = true;
    const animation = ref.current && feedbackMotion(ref.current, { opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(4%)" }, "press");
    const finish = () => { if (active) done.current(exit.id); };
    if (animation) void animation.finished.then(finish, finish); else finish();
    return () => { active = false; animation?.cancel(); };
  }, [exit.id]);
  return <details ref={ref} open={exit.open} className="waygoal-material-exit" style={exit.style} inert aria-hidden="true">
    <summary>{MATERIAL_SCOPES[exit.material.scope]} · {exit.material.parts.length} 条文字 <span>×</span></summary>
    <p>来源：{exit.material.sessionId} / {exit.material.turnId} · {exit.material.capturedAt}</p>
    {exit.material.parts.map(part => <pre key={part.entryId}>{part.text}</pre>)}
  </details>;
}

/** Exit visuals are inert and separate from promptMaterials. Removing then
 * immediately sending cannot accidentally include a fading material. */
export function WaygoalMaterialTray({ materials, arrival, onRemove }: {
  materials: MaterialSnapshot[]; arrival: MaterialArrival | null; onRemove: (index: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [exits, setExits] = useState<Exit[]>([]);
  const nextExit = useRef(0);
  const positions = useRef(new Map<string, number>());
  const removing = useRef(false);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const rows = Array.from(element.querySelectorAll<HTMLElement>("[data-material-key]"));
    const next = new Map(rows.map(row => [row.dataset.materialKey!, row.offsetTop]));
    if (removing.current) for (const row of rows) {
      const before = positions.current.get(row.dataset.materialKey!);
      if (before !== undefined && before !== row.offsetTop) feedbackMotion(row, { transform: `translateY(${before - row.offsetTop}px)` }, { transform: "none" }, "press", true);
    }
    removing.current = false; positions.current = next;
    // Restoring a session's saved tray is deliberately quiet.
    if (!arrival?.allowed() || revealedArrivals.has(arrival)) return;
    const target = rows.find(row => row.dataset.materialKey === identity(arrival.material));
    if (target) {
      revealedArrivals.add(arrival);
      feedbackMotion(target, { opacity: 0, transform: "translateY(4%)" }, { opacity: 1, transform: "none" });
    }
  }, [materials, arrival]);
  if (!materials.length && !exits.length) return <div ref={root} />;
  return <div ref={root} className="waygoal-material-tray" aria-label="下一轮引用材料">
    <strong>下一轮引用 · 发送时带入以下原文</strong>
    {materials.map((material, index) => <details key={identity(material)} data-material-key={identity(material)}>
      <summary>{MATERIAL_SCOPES[material.scope]} · {material.parts.length} 条文字 <button type="button" onClick={event => {
        event.preventDefault();
        const row = event.currentTarget.closest("details")!;
        const allowed = feedbackIntent(root.current);
        if (allowed()) {
          const id = ++nextExit.current;
          setExits(current => [...current, { id, material, open: row.open, style: { left: row.offsetLeft, top: row.offsetTop, width: row.offsetWidth, height: row.offsetHeight } }]);
          removing.current = true;
        }
        onRemove(index);
      }} aria-label={`移除材料 ${index + 1}`}>×</button></summary>
      <p>来源：{material.sessionId} / {material.turnId} · {material.capturedAt}</p>
      {material.parts.map(part => <pre key={part.entryId}>{part.text}</pre>)}
    </details>)}
    {exits.map(exit => <ExitingMaterial key={exit.id} exit={exit} onDone={id => setExits(current => current.filter(item => item.id !== id))} />)}
  </div>;
}
