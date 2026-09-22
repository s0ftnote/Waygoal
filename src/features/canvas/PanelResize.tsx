"use client";
import { useEffectEvent, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

const STORAGE_KEY = "waygoal.chat-panel-size";
type Size = { width?: number; height?: number };
type Axis = "width" | "height" | "both";

/** Resize the existing panel in place: the host chat never unmounts. */
export function WaygoalPanelResize() {
  const anchor = useRef<HTMLDivElement>(null);
  const preferred = useRef<Size>({});
  const drag = useRef<{ x: number; y: number; width: number; height: number; axis: Axis; before: Size; pointerId: number; handle: HTMLButtonElement } | null>(null);

  function apply(size: Size) {
    preferred.current = size;
    const app = anchor.current?.closest<HTMLElement>(".waygoal-app");
    for (const axis of ["width", "height"] as const) {
      const name = `--wg-chat-preferred-${axis}`;
      if (size[axis] === undefined) app?.style.removeProperty(name);
      else app?.style.setProperty(name, `${size[axis]}px`);
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferred.current)); } catch { /* Resizing also works with storage disabled. */ }
  }
  function reset() { apply({}); save(); }

  function change(width: number, height: number, axis: Axis) {
    const stage = anchor.current?.closest(".waygoal-stage")?.getBoundingClientRect();
    if (!stage) return;
    const maxWidth = Math.max(360, stage.width - 280), maxHeight = Math.max(0, stage.height - 28);
    apply({
      ...preferred.current,
      ...(axis !== "height" ? { width: Math.round(Math.max(360, Math.min(maxWidth, width))) } : {}),
      ...(axis !== "width" ? { height: Math.round(Math.max(Math.min(360, maxHeight), Math.min(maxHeight, height))) } : {}),
    });
  }
  function start(event: PointerEvent<HTMLButtonElement>, axis: Axis) {
    if (event.button !== 0 || drag.current) return;
    const panel = anchor.current?.closest(".waygoal-panel")?.getBoundingClientRect();
    if (!panel) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, width: panel.width, height: panel.height, axis, before: { ...preferred.current }, pointerId: event.pointerId, handle: event.currentTarget };
    event.currentTarget.dataset.resizing = "true";
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const origin = drag.current;
    if (origin?.pointerId === event.pointerId) change(origin.width + origin.x - event.clientX, origin.height + origin.y - event.clientY, origin.axis);
  }
  function finish(pointerId: number, cancelled = false) {
    const origin = drag.current;
    if (!origin || origin.pointerId !== pointerId) return;
    drag.current = null;
    origin.handle.removeAttribute("data-resizing");
    if (cancelled) apply(origin.before);
    if (origin.handle.hasPointerCapture(pointerId)) origin.handle.releasePointerCapture(pointerId);
    save();
  }
  const cancelResize = useEffectEvent(() => { if (drag.current) finish(drag.current.pointerId, true); });

  useLayoutEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      const size: Size = {};
      for (const axis of ["width", "height"] as const) {
        if (typeof saved?.[axis] === "number" && Number.isFinite(saved[axis]) && saved[axis] > 0) size[axis] = saved[axis];
      }
      apply(size);
    } catch { /* Ignore invalid preferences. */ }
    const cancel = () => cancelResize();
    window.addEventListener("blur", cancel);
    return () => { window.removeEventListener("blur", cancel); cancel(); };
  }, []);

  function keyboard(event: KeyboardEvent<HTMLButtonElement>, axis: Axis) {
    if (drag.current && event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); finish(drag.current.pointerId, true); return;
    }
    if (event.key === "Home") { event.preventDefault(); reset(); return; }
    const horizontal = axis !== "height" && ["ArrowLeft", "ArrowRight"].includes(event.key);
    const vertical = axis !== "width" && ["ArrowUp", "ArrowDown"].includes(event.key);
    if (!horizontal && !vertical) return;
    const rect = anchor.current?.closest(".waygoal-panel")?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    const delta = (event.shiftKey ? 48 : 16) * (["ArrowLeft", "ArrowUp"].includes(event.key) ? 1 : -1);
    change(rect.width + (horizontal ? delta : 0), rect.height + (vertical ? delta : 0), horizontal ? "width" : "height");
    save();
  }

  return <div ref={anchor} className="waygoal-panel-resize">
    {([ ["width", "调节聊天框宽度"], ["height", "调节聊天框高度"], ["both", "调节聊天框大小"] ] as const).map(([axis, label]) =>
      <button key={axis} type="button" className={`waygoal-resize-handle waygoal-resize-${axis}`} aria-label={label}
        title={`${label} · 拖动或方向键调节，双击或 Home 恢复默认，Escape 取消拖动`}
        onPointerDown={event => start(event, axis)} onPointerMove={move}
        onPointerUp={event => finish(event.pointerId)} onPointerCancel={event => finish(event.pointerId, true)} onLostPointerCapture={event => finish(event.pointerId, true)}
        onDoubleClick={reset} onKeyDown={event => keyboard(event, axis)} />)}
  </div>;
}
