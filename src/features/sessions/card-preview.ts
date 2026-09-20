import { skillExpansionToCommand } from "../../shared/slash-display";

/** Display-only, before truncation. Material capture still reads full Pi text. */
export function questionPreview(text: string): string {
  const compact = skillExpansionToCommand(text) ?? text;
  return compact.replace(/^@((?:\/[^\s]+)+)/gm, (_, path: string) => `@${path.split("/").at(-1)}`);
}
