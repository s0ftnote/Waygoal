"use client";
import { useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

const STORAGE_KEY = "waygoal.chat-panel-size";
type Size = { width?: number; height?: number };
type Axis = "width" | "height" | "both";

/** Resize the existing panel in place: the host chat never unmounts. */
export function WaygoalPanelResize() {
  const anchor = useRef<HTMLDivElement>(null);
  const preferred = useRef<Size>({});
  const drag = useRef<{ x: number; y: number; width: number; height: number; axis: Axis; before: Size } | null>(null);

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

  useLayoutEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      const size: Size = {};
      for (const axis of ["width", "height"] as const) {
        if (typeof saved?.[axis] === "number" && Number.isFinite(saved[axis]) && saved[axis] > 0) size[axis] = saved[axis];
      }
      apply(size);
    } catch { /* Ignore invalid preferences. */ }
  }, []);

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
    if (event.button !== 0) return;
    const panel = anchor.current?.closest(".waygoal-panel")?.getBoundingClientRect();
    if (!panel) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, width: panel.width, height: panel.height, axis, before: { ...preferred.current } };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const origin = drag.current;
    if (origin) change(origin.width + origin.x - event.clientX, origin.height + origin.y - event.clientY, origin.axis);
  }
  function finish(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    if (!drag.current) return;
    if (cancelled) apply(drag.current.before);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    save();
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, axis: Axis) {
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
        title={`${label} · 拖动或方向键调节，双击或 Home 恢复默认`}
        onPointerDown={event => start(event, axis)} onPointerMove={move}
        onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event)}
        onDoubleClick={reset} onKeyDown={event => keyboard(event, axis)} />)}
  </div>;
}
