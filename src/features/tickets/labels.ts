/** The words the canvas and the panel both use for a source and a card, kept
 *  in one place so the two never disagree. Copy only: no types, no rules. */

/** What a source is called on screen. A source Waygoal has no reader for is
 *  called by its own name rather than renamed into something it is not. */
export const remoteSourceLabel = (source: string): string =>
  ({ github: "GitHub", custom: "离线样本" } as Record<string, string>)[source] ?? source;

/** What a card is, in the two places that say it. */
export const mapKind = (remote: boolean): string => (remote ? "来源" : "本地地图");
export const ticketKind = (remote: boolean): string => (remote ? "来源票据" : "本地票据");
