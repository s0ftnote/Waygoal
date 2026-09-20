/** Local, one-shot feedback. These animations never own application state. */
const playing = new Map<Element, Animation>();
const epochs = new WeakMap<Element, number>();

/** A connected component either translates together or settles immediately. */
export function coherentShifts(shifts: Map<string, { x: number; y: number }>, edges: [string, string][]) {
  const result = new Map(shifts);
  let removed = true;
  while (removed) {
    removed = false;
    for (const [from, to] of edges) {
      const a = result.get(from), b = result.get(to);
      if ((a || b) && (!a || !b || Math.abs(a.x - b.x) > .01 || Math.abs(a.y - b.y) > .01)) {
        removed = result.delete(from) || removed; removed = result.delete(to) || removed;
      }
    }
  }
  return result;
}

export function stopFeedback(root: Element) {
  epochs.set(root, (epochs.get(root) ?? 0) + 1);
  for (const [element, animation] of playing) if (root.contains(element)) animation.cancel();
}

/** Capture before an async operation: typing/another gesture during its request
 * must not cause a late animation when the response eventually arrives. */
export function feedbackIntent(element: Element | null): () => boolean {
  const root = element?.closest<HTMLElement>(".waygoal-app");
  const epoch = root ? epochs.get(root) ?? 0 : 0;
  const pointer = root?.dataset.input === "pointer";
  return () => Boolean(pointer && root?.isConnected && root.dataset.input === "pointer" && (epochs.get(root) ?? 0) === epoch);
}

export function feedbackMotion(element: Element, from: Keyframe, to: Keyframe,
  duration: "press" | "reveal" | "travel" = "reveal", moving = false) {
  const root = element.closest<HTMLElement>(".waygoal-app");
  if (!root || root.dataset.input !== "pointer") return null;
  const tokens = getComputedStyle(root);
  const time = tokens.getPropertyValue(`--wg-motion-${duration}`).trim();
  const frames = [{ ...from }, { ...to }];
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) frames.forEach(frame => delete frame.transform);
  const previous = playing.get(element);
  if (previous) {
    // Retarget a rapid reversal from the visible state, not its first frame.
    const current = getComputedStyle(element);
    if ("opacity" in from) frames[0].opacity = current.opacity;
    if ("transform" in frames[0] && !moving) frames[0].transform = current.transform;
    previous.cancel();
  }
  const animation = element.animate(frames, {
    duration: parseFloat(time) * (time.endsWith("ms") ? 1 : 1000),
    easing: tokens.getPropertyValue(moving ? "--wg-ease-travel" : "--wg-ease-out").trim(),
  });
  playing.set(element, animation);
  const release = () => { if (playing.get(element) === animation) playing.delete(element); };
  void animation.finished.then(release, release);
  return animation;
}
