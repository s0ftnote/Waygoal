import type { MaterialSnapshot } from "@/features/materials/materials";

export type MaterialSourceLabels = Record<string, { title: string; turnLabel?: string }>;

export function materialSourceLabel(material: MaterialSnapshot, labels?: MaterialSourceLabels) {
  const source = labels?.[`${material.sessionId}:${material.turnId}`];
  return {
    title: source?.title.trim() || (material.sessionId
      ? `会话名称未知 · 来源 ID：${material.sessionId}` : "来源会话未知（缺少 ID）"),
    turnLabel: source?.turnLabel?.trim() || (material.turnId
      ? `轮次 / 问题未知 · 来源 ID：${material.turnId}` : "来源轮次未知（缺少 ID）"),
  };
}

/** Count only snapshot text, in Unicode code points (including whitespace).
 * Not tokens, UTF-16 code units, or the metadata added during submission. */
export function materialTextCharacters(materials: readonly MaterialSnapshot[]) {
  let count = 0;
  for (const material of materials) for (const part of material.parts) {
    count += Array.from(part.text).length;
  }
  return count;
}
