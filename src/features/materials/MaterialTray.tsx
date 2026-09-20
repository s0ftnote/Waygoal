"use client";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { MATERIAL_SCOPES, type MaterialSnapshot } from "@/features/materials/materials";
import { feedbackIntent, feedbackMotion } from "../canvas/feedback-motion";
import { materialSourceLabel, materialTextCharacters, type MaterialSourceLabels } from "./material-tray-presentation";
import "./MaterialTray.css";

export type MaterialArrival = { material: MaterialSnapshot; allowed: () => boolean };
const revealedArrivals = new WeakSet<MaterialArrival>();
const identity = (material: MaterialSnapshot) => `${material.sessionId}:${material.turnId}`;
type SourceLabel = ReturnType<typeof materialSourceLabel>;
type Exit = { id: number; material: MaterialSnapshot; label: SourceLabel; index: number; locatable: boolean; open: boolean; style: CSSProperties };

function MaterialContents({ material, label, index, open, locatable, onLocate, onRemove }: {
  material: MaterialSnapshot; label: SourceLabel; index: number; open?: boolean;
  locatable: boolean; onLocate?: () => void; onRemove?: () => void;
}) {
  return <>
    <div className="waygoal-material-source">
      <strong>{label.title}</strong>
      {label.turnLabel !== label.title && <span>{label.turnLabel}</span>}
    </div>
    <div className="waygoal-material-actions">
      <button type="button" className="waygoal-material-locate" disabled={!locatable}
        title={locatable ? "只读查看来源，不改变材料或继续路径" : "暂无法定位来源；仍可展开已保存的原文"}
        onClick={onLocate}>查看来源</button>
      <button type="button" className="waygoal-material-remove" onClick={onRemove} aria-label={`移除材料 ${index + 1}`}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </div>
    <details open={open}>
      <summary>
        <span>{MATERIAL_SCOPES[material.scope]} · {materialTextCharacters([material]).toLocaleString("zh-CN")} 字 · {material.parts.length} 条文字</span>
        <span className="waygoal-material-disclosure"><span className="waygoal-material-expand">展开原文</span><span className="waygoal-material-collapse">收起原文</span></span>
      </summary>
      <p className="waygoal-material-provenance">来源会话 ID：{material.sessionId || "未知"} · 轮次 ID：{material.turnId || "未知"}</p>
      <p className="waygoal-material-captured">取得时间：{material.capturedAt ? <time dateTime={material.capturedAt}>{material.capturedAt}</time> : "未知"}</p>
      {material.parts.map(part => <pre key={part.entryId}>{part.text}</pre>)}
    </details>
  </>;
}

function ExitingMaterial({ exit, onDone }: { exit: Exit; onDone: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone); done.current = onDone;
  useLayoutEffect(() => {
    let active = true;
    const animation = ref.current && feedbackMotion(ref.current, { opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(4%)" }, "press");
    const finish = () => { if (active) done.current(exit.id); };
    if (animation) void animation.finished.then(finish, finish); else finish();
    return () => { active = false; animation?.cancel(); };
  }, [exit.id]);
  return <div ref={ref} className="waygoal-material-row waygoal-material-exit" style={exit.style} inert aria-hidden="true">
    <MaterialContents material={exit.material} label={exit.label} index={exit.index} locatable={exit.locatable} open={exit.open} />
  </div>;
}

/** Exit visuals are inert and separate from promptMaterials. Removing then
 * immediately sending cannot accidentally include a fading material. */
export function WaygoalMaterialTray({ materials, arrival, onRemove, sourceLabels, onLocate }: {
  materials: MaterialSnapshot[]; arrival: MaterialArrival | null; onRemove: (index: number) => void;
  sourceLabels?: MaterialSourceLabels;
  /** Read-only navigation. Must not switch the continuing path or mutate materials. */
  onLocate?: (material: MaterialSnapshot) => void;
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
  if (!materials.length && !exits.length) return <div ref={root} tabIndex={-1} />;
  return <div ref={root} className="waygoal-material-tray waygoal-material-review" role="region" tabIndex={-1} aria-label="下一轮引用材料">
    <header className="waygoal-material-heading">
      <strong>本次额外带入</strong>
      <span className="waygoal-material-total" aria-live="polite" aria-atomic="true">{materials.length} 份 · {materialTextCharacters(materials).toLocaleString("zh-CN")} 个文本字符</span>
    </header>
    <p className="waygoal-material-note">仅含你选定的原文，不代表完整 Pi 上下文。字符量不是 token 数。</p>
    {materials.map((material, index) => <div className="waygoal-material-row" key={identity(material)} data-material-key={identity(material)}>
      <MaterialContents material={material} label={materialSourceLabel(material, sourceLabels)} index={index} locatable={Boolean(onLocate)}
        onLocate={() => onLocate?.(material)} onRemove={() => {
        const rows = Array.from(root.current!.querySelectorAll<HTMLElement>("[data-material-key]"));
        const row = rows[index];
        const allowed = feedbackIntent(root.current);
        if (allowed()) {
          const id = ++nextExit.current;
          setExits(current => [...current, { id, material, label: materialSourceLabel(material, sourceLabels), index, locatable: Boolean(onLocate), open: row.querySelector("details")!.open, style: { left: row.offsetLeft, top: row.offsetTop, width: row.offsetWidth, height: row.offsetHeight } }]);
          removing.current = true;
        }
        // A removed control must not drop keyboard focus into the document body.
        if (row.contains(document.activeElement)) {
          const next = rows[index + 1] ?? rows[index - 1];
          (next?.querySelector("summary") ?? root.current)?.focus({ preventScroll: true });
        }
        onRemove(index);
      }} />
    </div>)}
    {exits.map(exit => <ExitingMaterial key={exit.id} exit={exit} onDone={id => setExits(current => current.filter(item => item.id !== id))} />)}
  </div>;
}
