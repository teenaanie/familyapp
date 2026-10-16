// Loose name matching for spoken names ("Ravi" → "Ravi (gardener)", "gardener" → "Ravi (gardener)").

const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && w !== "the");

/** Returns the best candidate, or null when nothing (or more than one equally) fits. */
export function matchName<T>(spoken: string, candidates: T[], nameOf: (c: T) => string): T | null {
  const said = words(spoken);
  if (!said.length) return null;
  let best: T | null = null;
  let bestScore = 0;
  let tie = false;
  for (const c of candidates) {
    const name = words(nameOf(c));
    if (name.join(" ") === said.join(" ")) return c; // exact
    const hits = said.filter((w) => name.some((n) => n === w || (w.length >= 4 && (n.startsWith(w) || w.startsWith(n))))).length;
    const score = hits / said.length;
    if (score > bestScore) {
      best = c;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0) tie = true;
  }
  return bestScore >= 0.5 && !tie ? best : null;
}

/** Same name ignoring case, punctuation and "the" — used to spot true duplicates, not partial matches. */
export function sameName(a: string, b: string): boolean {
  return words(a).join(" ") === words(b).join(" ");
}
