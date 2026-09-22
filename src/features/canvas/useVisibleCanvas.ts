"use client";
import { useEffect, useState } from "react";
import type { WaygoalView } from "@/shared/waygoal-types";
import type { WaygoalSize } from "./locate";
import { unionBoxes, visibleWorldBox } from "./visible-scene";

/** Include the rendered camera during a CSS transition, not just its target.
 * This keeps long navigation moves populated and releases old DOM on arrival. */
export function useVisibleCanvas(world: HTMLElement | null, camera: WaygoalView, size: WaygoalSize) {
  const [rendered, setRendered] = useState(camera);
  useEffect(() => {
    if (!world) return;
    let frame = 0;
    const sample = () => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform);
      const current = { x: matrix.e, y: matrix.f, scale: matrix.a || camera.scale };
      // Computed matrices round large world coordinates. An ended transition
      // must not leave a permanent sampling loop waiting for exact decimals.
      const animating = world.getAnimations().some(animation => animation.pending || animation.playState === "running" || animation.playState === "paused");
      const arrived = !animating || Math.abs(current.x - camera.x) < .1 && Math.abs(current.y - camera.y) < .1 && Math.abs(current.scale - camera.scale) < .00001;
      const next = arrived ? camera : current;
      setRendered(previous => previous.x === next.x && previous.y === next.y && previous.scale === next.scale ? previous : next);
      if (!arrived) frame = requestAnimationFrame(sample);
    };
    // Do not synchronously set state during the layout phase: Map header
    // measurements and overview fitting must finish their own layout commit.
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [world, camera]);
  return unionBoxes(visibleWorldBox(camera, size), visibleWorldBox(rendered, size));
}
