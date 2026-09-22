import type { WaygoalView } from "../../shared/waygoal-types";
import type { WaygoalBox, WaygoalSize } from "./locate";

/** Screen-pixel overscan stays useful at every zoom level. Geometry remains
 * complete elsewhere; these bounds only decide which DOM needs to exist. */
export function visibleWorldBox(view: WaygoalView, size: WaygoalSize, margin = 320): WaygoalBox {
  return { x: (-view.x - margin) / view.scale, y: (-view.y - margin) / view.scale,
    width: (size.width + margin * 2) / view.scale, height: (size.height + margin * 2) / view.scale };
}

export function unionBoxes(a: WaygoalBox, b: WaygoalBox): WaygoalBox {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

export function intersectsView(view: WaygoalBox, box: WaygoalBox): boolean {
  return box.x <= view.x + view.width && box.x + box.width >= view.x
    && box.y <= view.y + view.height && box.y + box.height >= view.y;
}
