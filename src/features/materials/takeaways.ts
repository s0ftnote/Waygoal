/** A map annotation, never a replacement for Pi messages or prompt material. */
export interface TurnTakeaway {
  text: string;
  status: "draft" | "confirmed";
  fingerprint: string;
}
export type ZoomTier = "detail" | "map" | "overview";

/** Separate entry/exit thresholds keep the labels steady around a boundary. */
export function zoomTier(scale: number, previous: ZoomTier): ZoomTier {
  if (previous === "detail") return scale <= .32 ? "overview" : scale <= .72 ? "map" : "detail";
  if (previous === "map") return scale >= .84 ? "detail" : scale <= .32 ? "overview" : "map";
  return scale >= .84 ? "detail" : scale >= .4 ? "map" : "overview";
}

export function validTakeaway(value: unknown): value is TurnTakeaway {
  if (!value || typeof value !== "object") return false;
  const item = value as TurnTakeaway;
  return typeof item.text === "string" && Boolean(item.text.trim()) && Array.from(item.text).length <= 80
    && (item.status === "draft" || item.status === "confirmed")
    && typeof item.fingerprint === "string" && item.fingerprint.length > 0 && item.fingerprint.length <= 128;
}

export function takeawayChanged(item: TurnTakeaway, fingerprint?: string): boolean {
  return !fingerprint || item.fingerprint !== fingerprint;
}

export function cleanTakeaway(raw: string): string {
  const text = raw.trim().replace(/^```(?:text)?\s*|\s*```$/g, "").split(/\r?\n/)[0]
    .replace(/^(?:所得|结论|摘要|takeaway)\s*[:：]\s*/i, "").replace(/^["“「]|["”」]$/g, "").trim();
  if (!/[\p{L}\p{N}]/u.test(text)) throw new Error("没有得到可用的提炼文字，请重试或自己填写。");
  return Array.from(text).slice(0, 80).join("");
}
