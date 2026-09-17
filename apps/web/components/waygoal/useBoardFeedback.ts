"use client";
import { useCallback, useLayoutEffect, useRef } from "react";
import { coherentShifts, feedbackIntent, feedbackMotion } from "./feedback-motion";

type Item = { element: HTMLElement; x: number; y: number; owner: string };
type Action = { kind: "expand" | "collapse" | "fork"; session: string; allowed: () => boolean; until: number };

/** Observe only explicit spatial operations. Polling, history restoration and
 * ordinary new turns do not acquire an entrance animation. Positions stay in
 * world coordinates, independent of simultaneous camera movement. */
export function useBoardFeedback(world: HTMLElement | null, scope: string) {
  const previous = useRef(new Map<string, Item>());
  const action = useRef<Action | null>(null);
  const ghosts = useRef(new Map<string, HTMLElement>());
  const knownEdges = useRef(new Set<string>());
  const read = useCallback(() => new Map(Array.from(world?.querySelectorAll<HTMLElement>("[data-spatial-key]") ?? [], element => [element.dataset.spatialKey!, {
    element, x: parseFloat(element.style.left) || 0, y: parseFloat(element.style.top) || 0, owner: element.dataset.spatialOwner!,
  }])), [world]);

  const begin = useCallback((kind: Action["kind"], session: string, allowed = feedbackIntent(world)) => {
    previous.current = read();
    // The host's poll may expose the newly created session before the fork
    // request has finished registering its provenance. Success still gets one
    // reveal, without treating any inherited cards as newly created.
    if (kind === "fork") for (const [key, item] of previous.current) if (item.owner === session) previous.current.delete(key);
    knownEdges.current = new Set(Array.from(world?.querySelectorAll<SVGElement>("[data-spatial-edge]") ?? [], edge => edge.dataset.spatialEdge!));
    action.current = allowed() ? { kind, session, allowed, until: performance.now() + 2500 } : null;
  }, [world, read]);

  useLayoutEffect(() => {
    if (!world) return;
    previous.current = read(); action.current = null;
    const exits = ghosts.current;
    const observer = new MutationObserver(() => {
      const request = action.current;
      if (!request || !request.allowed() || performance.now() > request.until) { action.current = null; return; }
      const current = read(), before = previous.current;
      previous.current = current;
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const camera = new DOMMatrixReadOnly(getComputedStyle(world).transform), scale = camera.a;
      let shifts = new Map<string, { x: number; y: number }>();
      for (const [key, item] of current) {
        const old = before.get(key);
        if (!old || old.x === item.x && old.y === item.y) continue;
        const visible = new DOMMatrixReadOnly(getComputedStyle(old.element).transform);
        const x = old.x + visible.e - item.x, y = old.y + visible.f - item.y;
        // A dense board must not sweep across the screen when it unfolds.
        if (!reduce && Math.hypot(x, y) * scale <= 24) shifts.set(key, { x, y });
      }
      const edges = Array.from(world.querySelectorAll<SVGElement>("[data-spatial-from]"));
      for (const edge of edges) {
        const key = edge.dataset.spatialEdge;
        if (key && !knownEdges.current.has(key)) {
          knownEdges.current.add(key);
          if (request.kind !== "fork" || edge.dataset.forkTarget === request.session) feedbackMotion(edge, { opacity: 0 }, { opacity: 1 }, request.kind === "fork" ? "reveal" : "press");
        }
      }
      // Translate a connected cluster only when BOTH endpoints travel together.
      // Otherwise settle its geometry immediately. Never stretch a line, detach
      // an endpoint or animate SVG path data just to decorate a layout change.
      shifts = coherentShifts(shifts, edges.map(edge => [edge.dataset.spatialFrom!, edge.dataset.spatialTo!]));
      for (const [key, delta] of shifts) feedbackMotion(current.get(key)!.element,
        { transform: `translate(${delta.x}px, ${delta.y}px)` }, { transform: "none" }, "press", true);
      for (const edge of edges) {
        const delta = shifts.get(edge.dataset.spatialFrom!);
        if (delta) feedbackMotion(edge, { transform: `translate(${delta.x}px, ${delta.y}px)` }, { transform: "none" }, "press", true);
      }
      for (const [key, item] of current) {
        if (before.has(key) || item.owner !== request.session) continue;
        exits.get(key)?.remove(); exits.delete(key);
        // Move only the new branch's inner face: the actual card and all line
        // endpoints already occupy their final geometry and remain clickable.
        const target = request.kind === "fork" ? item.element.querySelector("[data-spatial-face]") ?? item.element : item.element;
        feedbackMotion(target, { opacity: 0, ...(request.kind === "fork" ? { transform: "translateX(-4%)" } : {}) },
          { opacity: 1, transform: "none" }, request.kind === "fork" && !reduce ? "travel" : request.kind === "fork" ? "reveal" : "press");
      }
      if (request.kind === "collapse") for (const [key, item] of before) {
        if (current.has(key) || item.owner !== request.session || exits.has(key)) continue;
        const width = (parseFloat(item.element.style.width) || 250) * scale;
        const height = (parseFloat(item.element.style.height) || 150) * scale;
        const x = item.x * scale + camera.e, y = item.y * scale + camera.f;
        // Hundreds of subpixel/offscreen history cards need no exit layers.
        if (width < 12 || x + width < 0 || y + height < 0 || x > world.parentElement!.clientWidth || y > world.parentElement!.clientHeight) continue;
        const ghost = item.element.cloneNode(true) as HTMLElement;
        // A visual exit cannot masquerade as a live card or retain focus targets.
        for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
          node.removeAttribute("id");
          for (const attribute of Array.from(node.attributes)) if (attribute.name.startsWith("data-")) node.removeAttribute(attribute.name);
        }
        const holder = document.createElement("div");
        holder.className = "waygoal-turn-world";
        holder.dataset.zoomTier = world.querySelector<HTMLElement>("[data-zoom-tier]")?.dataset.zoomTier;
        holder.inert = true; holder.setAttribute("aria-hidden", "true");
        ghost.inert = true; ghost.setAttribute("aria-hidden", "true"); ghost.classList.add("waygoal-spatial-exit");
        holder.append(ghost); world.append(holder); exits.set(key, holder);
        const animation = feedbackMotion(ghost, { opacity: 1 }, { opacity: 0 }, "press");
        const finish = () => { holder.remove(); if (exits.get(key) === holder) exits.delete(key); };
        if (animation) void animation.finished.then(finish, finish); else finish();
      }
    });
    observer.observe(world, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "d"] });
    return () => { observer.disconnect(); action.current = null; exits.forEach(element => element.remove()); exits.clear(); };
  }, [world, scope, read]);
  return begin;
}
