import type { WaygoalMapSection, WaygoalSourceLink } from "./types";

/** A source file's own `##` sections, in its own order and its own words. The
 *  body is kept verbatim — the point is to show what the map says, not a
 *  retelling of it, so nothing here summarises, reorders or renames. */
export function mapSections(body: string): WaygoalMapSection[] {
  const sections: WaygoalMapSection[] = [];
  const lines = body.split("\n");
  let current: WaygoalMapSection | null = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { heading: heading[1], body: "" };
      sections.push(current);
      continue;
    }
    // Anything before the first `##` belongs to the file, not to a section:
    // inventing a heading for it would be writing something the source did not.
    if (current) current.body += `${line}\n`;
  }
  return sections.map(section => ({ ...section, body: section.body.trim() }));
}

/** What the file says before its first `##`. It is shown as its own opening
 *  rather than filed under a heading the source never wrote. */
export function mapLead(body: string): string {
  const lines = body.split("\n");
  const first = lines.findIndex(line => /^##\s+.+$/.test(line));
  return (first === -1 ? lines : lines.slice(0, first)).join("\n").trim();
}

/** Every place the source explicitly points at, written as a Markdown link.
 *  Only links count: a file name mentioned in a sentence is the source talking
 *  about something, not the source saying where to go — and guessing from
 *  prose is exactly the inference this must not do. */
export function sourceLinks(body: string): WaygoalSourceLink[] {
  const links: WaygoalSourceLink[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/\[([^\]\n]*)\]\(([^)\s]+)\)/g)) {
    const target = match[2].trim();
    // An anchor points inside the text that is already open, so it is not a
    // place to go; an empty target names nothing.
    if (!target || target.startsWith("#") || seen.has(target)) continue;
    seen.add(target);
    links.push({ label: match[1].trim() || target, target, external: /^[a-z][a-z0-9+.-]*:/i.test(target) });
  }
  return links;
}
