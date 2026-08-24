// Decides when an AI-suggested place name has been resolved confidently enough
// to verify without asking, and when it genuinely needs a human to choose.
// Kept free of network calls so the thresholds can be tested directly.

export type MatchCandidate = { name: string; address: string };

export type MatchOutcome<T extends MatchCandidate> =
  | { status: "verified"; place: T; score: number }
  | { status: "ambiguous"; alternates: T[]; score: number }
  | { status: "not_found" };

// Words that carry no identifying signal, so their presence should not make two
// different places look alike.
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "de",
  "la",
  "le",
  "el",
  "and",
  "y",
  "et",
  "museum",
  "gallery",
  "park",
  "cathedral",
  "church",
  "market",
  "palace",
  "garden",
  "tower",
  "castle",
]);

export function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function contentTokens(value: string) {
  const all = normalizeName(value).split(" ").filter(Boolean);
  const meaningful = all.filter((token) => !STOPWORDS.has(token));
  // If a name is nothing but generic words, fall back to all of them rather
  // than comparing two empty sets and calling it a perfect match.
  return meaningful.length ? meaningful : all;
}

// 1 means the names agree completely; 0 means they share nothing meaningful.
export function nameScore(candidateName: string, placeName: string) {
  const candidate = normalizeName(candidateName);
  const place = normalizeName(placeName);

  if (!candidate || !place) return 0;
  if (candidate === place) return 1;

  const candidateTokens = contentTokens(candidateName);
  const placeTokens = contentTokens(placeName);

  if (!candidateTokens.length || !placeTokens.length) return 0;

  const placeSet = new Set(placeTokens);
  const shared = candidateTokens.filter((token) => placeSet.has(token)).length;

  // Measured against the shorter name, so "Prado" still matches
  // "Museo Nacional del Prado" rather than being punished for brevity.
  const overlap = shared / Math.min(candidateTokens.length, placeTokens.length);

  // A full-phrase containment is strong evidence even when token counts differ.
  if (place.includes(candidate) || candidate.includes(place)) {
    return Math.max(overlap, 0.9);
  }

  return overlap;
}

const CONFIDENT_SCORE = 0.7;
const CONFIDENT_LEAD = 0.25;

export function resolveMatch<T extends MatchCandidate>(
  candidateName: string,
  places: T[],
): MatchOutcome<T> {
  if (!places.length) return { status: "not_found" };

  const ranked = places
    .map((place) => ({ place, score: nameScore(candidateName, place.name) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const runnerUp = ranked[1];

  if (best.score < CONFIDENT_SCORE) {
    return {
      status: "ambiguous",
      alternates: ranked.slice(0, 5).map((entry) => entry.place),
      score: best.score,
    };
  }

  // A strong top match is only trustworthy if nothing else scores nearly as
  // well; two similarly named places mean the user has to pick.
  const hasClearLead = !runnerUp || best.score - runnerUp.score >= CONFIDENT_LEAD;

  if (!hasClearLead) {
    return {
      status: "ambiguous",
      alternates: ranked.slice(0, 5).map((entry) => entry.place),
      score: best.score,
    };
  }

  return { status: "verified", place: best.place, score: best.score };
}
