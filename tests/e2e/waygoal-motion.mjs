// Runs in the isolated session-canvas fixture, before sending any messages.
export async function verifyCanvasMotion(page, check) {
  const world = page.locator(".waygoal-world");
  const viewport = page.locator(".waygoal-viewport");
  const sample = () => world.evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, scale: matrix.a,
      moving: element.getAnimations().some(animation => animation.playState === "running" || animation.pending) };
  });
  // Slow and pause the real transition for a deterministic interruption check.
  await page.locator(".waygoal-app").evaluate(element => element.style.setProperty("--wg-motion-travel", "960ms"));
  await page.getByRole("button", { name: "放大", exact: true }).click();
  const paused = await world.evaluate(element => {
    const animation = element.getAnimations()[0];
    if (!animation) return false;
    animation.pause(); animation.currentTime = 320;
    return true;
  });
  check("pointer navigation has an interruptible camera transition", paused);
  const beforeGrab = await sample();
  const bounds = await viewport.boundingBox();
  const point = { x: bounds.x + bounds.width - 30, y: bounds.y + 30 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  const grabbed = await sample();
  check("grabbing a moving canvas keeps its rendered position", Math.abs(grabbed.scale - beforeGrab.scale) < .001 && Math.abs(grabbed.x - beforeGrab.x) < 1 && !grabbed.moving);
  await page.mouse.move(point.x - 70, point.y + 25, { steps: 5 });
  const dragged = await sample();
  check("canvas follows the pointer without easing", Math.abs(dragged.x - grabbed.x + 70) < 1 && Math.abs(dragged.y - grabbed.y - 25) < 1 && !dragged.moving);
  await page.mouse.up();
  await page.mouse.wheel(0, 100);
  await page.waitForFunction(scale => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".waygoal-world")).transform).a < scale, dragged.scale);
  check("wheel zoom has no trailing camera animation", !(await sample()).moving);
  await viewport.focus();
  await page.keyboard.press("ArrowRight");
  check("keyboard camera navigation is immediate", !(await sample()).moving);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "放大", exact: true }).click();
  check("reduced motion keeps camera navigation immediate", !(await sample()).moving);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(".waygoal-app").evaluate(element => element.style.removeProperty("--wg-motion-travel"));
  await viewport.focus();
  await page.keyboard.press("0");
}
