// Deciding whether two guardian records are the same person.

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "rev", "prof", "hon", "ven"]);

/** "Mrs. D. Perera" → ["d", "perera"]: lower-case words without titles or punctuation. */
export function nameTokens(name: string) {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t));
}

const tokenMatches = (a: string, b: string) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));

/**
 * Whether two names can belong to one person: every word of the shorter name matches a word of
 * the longer (an initial matches a full name), and at least one full word is shared.
 * "Mrs. Dilani Perera" ~ "D. Perera" ~ "Dilani Perera", but not "Mr. Upul Perera" (a spouse
 * sharing the family phone) or an unrelated name.
 */
export function sameGuardianName(a: string, b: string) {
  const [short, long] = [nameTokens(a), nameTokens(b)].sort((x, y) => x.length - y.length);
  if (!short!.length) return false;
  const all = short!.every((t) => long!.some((u) => tokenMatches(t, u)));
  const full = short!.some((t) => t.length > 1 && long!.includes(t));
  return all && full;
}
