"use client";
import { useEffect, useLayoutEffect, type RefObject } from "react";

/** Keep the workspace inside the visible browser area and give canvas pinches
 * one owner. Neither resizing nor zooming changes the current conversation. */
export function useCanvasViewport(appRef: RefObject<HTMLElement | null>, viewportRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const app = appRef.current, viewport = window.visualViewport;
    if (!app || !viewport) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      // A tab may already be pinched/offset when a conversation opens. Keep
      // the workspace inside what is actually visible, including its composer.
      app.style.setProperty("--wg-visible-width", `${viewport.width}px`);
      app.style.setProperty("--wg-visible-height", `${viewport.height}px`);
      app.style.setProperty("--wg-visible-left", `${viewport.offsetLeft}px`);
      app.style.setProperty("--wg-visible-top", `${viewport.offsetTop}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
    };
  }, [appRef]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Trackpad pinches arrive as Ctrl+wheel. React's passive wheel handler
    // zooms the canvas but cannot cancel the browser's simultaneous page zoom.
    const containZoom = (event: WheelEvent) => { if (event.ctrlKey) event.preventDefault(); };
    viewport.addEventListener("wheel", containZoom, { passive: false });
    return () => viewport.removeEventListener("wheel", containZoom);
  }, [viewportRef]);
}
