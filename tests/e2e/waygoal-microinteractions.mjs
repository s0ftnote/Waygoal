import { setTimeout as delay } from "node:timers/promises";

/** Exercise real pointer capture on the mounted chat, including cancellation. */
export async function verifyMicrointeractions(page, check) {
  const panel = page.locator('.waygoal-panel');
  const handle = page.getByRole('button', { name: '调节聊天框宽度', exact: true });
  await handle.waitFor();
  const composer = panel.locator('textarea').last();
  await composer.fill('尚未发送的想法');
  await composer.evaluate(el => { el.dataset.resizeContinuity = 'original'; });
  await handle.focus();
  await page.keyboard.press('Home');
  const width = async () => (await panel.boundingBox()).width;
  const before = await width();
  const begin = async () => {
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 64, box.y + box.height / 2, { steps: 4 });
    return box;
  };
  await begin();
  const during = await width();
  check('panel resizes before release and keeps its grab handle stationary', before - during > 50 && await handle.evaluate(el =>
    el.dataset.resizing === 'true' && getComputedStyle(el).transform === 'none' && getComputedStyle(el).translate === 'none'));
  await handle.evaluate(el => {
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 77, pointerType: 'touch', button: 0, clientX: 1200, clientY: 120,
    }));
  });
  check('a second pointer cannot steal or finish the resize', Math.abs(await width() - during) < 1 && await handle.getAttribute('data-resizing') === 'true');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  check('Escape restores the size and keeps the same chat mounted', Math.abs(await width() - before) < 1 && await panel.isVisible() && await handle.getAttribute('data-resizing') === null && await composer.inputValue() === '尚未发送的想法' && await composer.getAttribute('data-resize-continuity') === 'original');

  await begin();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  check('losing window focus cancels the resize without leaving an active handle', Math.abs(await width() - before) < 1 && await handle.getAttribute('data-resizing') === null);

  await begin();
  await page.mouse.up();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('waygoal.chat-panel-size')));
  check('releasing the owning pointer commits the live size', Math.abs(await width() - saved.width) < 1 && await handle.getAttribute('data-resizing') === null);
  await handle.focus();
  await page.keyboard.press('Home');

  await composer.fill('');
  const heading = page.locator('.waygoal-thumb-heading');
  const chevron = () => heading.evaluate(el => {
    const s = getComputedStyle(el, '::after');
    return { transform: s.transform, duration: s.transitionDuration };
  });
  const pressBox = await heading.boundingBox();
  await page.mouse.move(pressBox.x + pressBox.width / 2, pressBox.y + pressBox.height / 2);
  await page.mouse.down();
  await delay(150);
  check('pointer press uses one small scale and no downward jump', await heading.evaluate(el => {
    const s = getComputedStyle(el);
    return Math.abs(new DOMMatrixReadOnly(s.transform).a - .97) < .001 && s.translate === 'none';
  }));
  await page.mouse.up();
  await delay(150);
  const expanded = await chevron();
  check('thumbnail disclosure turns its chevron with brief pointer feedback', expanded.duration === '0.12s' && await page.locator('[data-thumb]').isVisible());
  await heading.focus();
  await page.keyboard.press('Enter');
  const collapsed = await chevron();
  check('keyboard disclosure responds instantly', collapsed.duration === '0s' && collapsed.transform !== expanded.transform);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const box = await heading.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await delay(150);
  check('reduced motion removes press scaling', await heading.evaluate(el => getComputedStyle(el).transform === 'none'));
  await page.mouse.up();
  // Restore the fixture's original folded thumbnail and motion preference.
  if (await page.locator('[data-thumb]').isVisible()) await heading.click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}
