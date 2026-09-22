"use client";
import { useCallback, useLayoutEffect, useRef } from "react";
import type { WaygoalView } from "@/shared/waygoal-types";
import { cardBounds, viewCenteredOn, type WaygoalCard, type WaygoalSize } from "./locate";

const sameView = (a: WaygoalView, b: WaygoalView) =>
  a.x === b.x && a.y === b.y && a.scale === b.scale;

export const DEFAULT_VIEW: WaygoalView = { x: 48, y: 96, scale: 1 };

/** Fit is a single navigation request. Map typography can reflow after zooming,
 * so finish only after the resulting geometry has settled. Later content
 * updates must not pull the user back into the overview. */
export function useCanvasFit(cards: WaygoalCard[], viewport: WaygoalSize, view: WaygoalView, navigate: (view: WaygoalView) => void) {
  const pending = useRef<{ target: WaygoalView; passes: number } | null>(null);
  const cancel = useCallback(() => { pending.current = null; }, []);
  const target = useCallback(() => {
    const box = cardBounds(cards);
    if (!box || !viewport.width) return DEFAULT_VIEW;
    const scale = Math.min(1, Math.max(.001, Math.min((viewport.width - 96) / box.width, (viewport.height - 200) / box.height)));
    return viewCenteredOn({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, { ...DEFAULT_VIEW, scale }, viewport);
  }, [cards, viewport]);
  const fit = useCallback(() => {
    const next = target();
    pending.current = sameView(next, view) ? null : { target: next, passes: 0 };
    navigate(next);
  }, [navigate, target, view]);

  useLayoutEffect(() => {
    const request = pending.current;
    if (!request) return;
    // Another navigation (including a restored viewport) supersedes this fit.
    if (!sameView(view, request.target)) { cancel(); return; }
    const next = target();
    if (!sameView(next, request.target)) {
      // Bound feedback even if newly arriving content keeps changing the scene.
      if (++request.passes > 12) { cancel(); return; }
      request.target = next;
      navigate(next);
      return;
    }
    // ResizeObserver reports the zoom-dependent header height after layout.
    // Leave that delivery and its React commit time to replace this candidate.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (pending.current === request) cancel();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [view, target, navigate, cancel]);

  return { fit, cancel };
}
