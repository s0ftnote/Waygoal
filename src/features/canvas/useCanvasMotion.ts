"use client";
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { stopFeedback } from "./feedback-motion";
import type { WaygoalView } from "@/shared/waygoal-types";

/** Navigation may ease; grabbing the canvas must start at the rendered position,
 * not at the destination of an unfinished transition. No timers or extra frames. */
export function useCanvasMotion(world: HTMLElement | null, view: WaygoalView, update: Dispatch<SetStateAction<WaygoalView>>) {
  const app = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = app.current;
    if (!root) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => stopFeedback(root);
    const outsideKey = (event: KeyboardEvent) => {
      if (event.target instanceof Node && root.contains(event.target)) return;
      root.dataset.input = "keyboard"; stop();
    };
    root.addEventListener("wheel", stop, { passive: true });
    document.addEventListener("keydown", outsideKey, true);
    media.addEventListener("change", stop);
    return () => { root.removeEventListener("wheel", stop); document.removeEventListener("keydown", outsideKey, true); media.removeEventListener("change", stop); stop(); };
  }, []);
  const navigate = useCallback<Dispatch<SetStateAction<WaygoalView>>>((next) => {
    world?.removeAttribute("data-direct");
    update(next);
  }, [world, update]);
  const grab = useCallback(() => {
    if (!world) return view;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
    const current = { x: matrix.e, y: matrix.f, scale: matrix.a };
    world.setAttribute("data-direct", "");
    // Freeze before React commits so disabling the transition cannot reveal its
    // old destination for one frame. React takes ownership again on that commit.
    world.style.transform = `translate(${current.x}px, ${current.y}px) scale(${current.scale})`;
    update(current);
    return current;
  }, [world, view, update]);
  const direct = useCallback<Dispatch<SetStateAction<WaygoalView>>>((next) => {
    world?.setAttribute("data-direct", "");
    update(next);
  }, [world, update]);
  const input = useCallback((kind: "pointer" | "keyboard") => {
    if (app.current) { app.current.dataset.input = kind; stopFeedback(app.current); }
    if (kind === "keyboard") {
      // WAAPI isn't governed by CSS media/input selectors.
      app.current?.querySelector(".waygoal-panel")?.getAnimations().forEach(animation => animation.cancel());
    }
  }, []);
  return { app, navigate, grab, direct, input };
}
