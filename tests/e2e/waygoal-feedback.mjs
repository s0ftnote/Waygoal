// Observe real WAAPI calls without changing their duration or completion.
export async function observeFeedback(page) {
  await page.addInitScript(() => {
    window.feedbackEvents = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      const event = { className: this.getAttribute('class') ?? '',
        spatial: this.closest('[data-spatial-key]')?.getAttribute('data-spatial-key'),
        material: this.getAttribute('data-material-key'), fork: this.getAttribute('data-fork-target'),
        frames, duration: options.duration, cancelled: false, inert: this.inert };
      window.feedbackEvents.push(event);
      animation.addEventListener('cancel', () => { event.cancelled = true; });
      return animation;
    };
  });
}

export const feedbackEvents = page => page.evaluate(() => window.feedbackEvents);
export const clearFeedback = page => page.evaluate(() => { window.feedbackEvents = []; });
