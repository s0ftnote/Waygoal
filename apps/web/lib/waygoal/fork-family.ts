/** Connected sessions, including absent parents that join visible siblings.
 * Each relationship is visited once; cycles cannot repeat a session. */
export function forkFamily(links: Iterable<readonly [string, string]>, seeds: Iterable<string>): Set<string> {
  const adjacent = new Map<string, string[]>();
  for (const [child, parent] of links) {
    if (!adjacent.has(child)) adjacent.set(child, []);
    if (!adjacent.has(parent)) adjacent.set(parent, []);
    adjacent.get(child)!.push(parent);
    adjacent.get(parent)!.push(child);
  }
  const family = new Set<string>(), queue = [...seeds];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (!id || family.has(id)) continue;
    family.add(id);
    for (const neighbor of adjacent.get(id) ?? []) queue.push(neighbor);
  }
  return family;
}
