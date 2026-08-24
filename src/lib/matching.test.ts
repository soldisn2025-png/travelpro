import { describe, expect, it } from "vitest";
import { nameScore, normalizeName, resolveMatch } from "@/lib/matching";

const place = (name: string, address = "somewhere") => ({ name, address });

describe("normalizeName", () => {
  it("strips accents so Sagrada Família matches Sagrada Familia", () => {
    expect(normalizeName("Sagrada Família")).toBe(normalizeName("Sagrada Familia"));
  });

  it("ignores punctuation and casing", () => {
    expect(normalizeName("St. Peter's Basilica")).toBe("st peter s basilica");
  });
});

describe("nameScore", () => {
  it("scores an exact match as 1", () => {
    expect(nameScore("Park Güell", "Park Güell")).toBe(1);
  });

  it("scores an unrelated place as 0", () => {
    expect(nameScore("Park Güell", "Tokyo Skytree")).toBe(0);
  });

  it("rewards a shorter name contained in the official one", () => {
    expect(nameScore("Prado", "Museo Nacional del Prado")).toBeGreaterThanOrEqual(0.9);
  });

  // Generic words alone must not create a match, or every museum in a city
  // would look like every other museum.
  it("does not match two places that share only a generic word", () => {
    expect(nameScore("Picasso Museum", "Maritime Museum")).toBeLessThan(0.7);
  });

  it("still matches when only the distinctive word differs in position", () => {
    expect(nameScore("Museu Picasso", "Picasso Museum")).toBeGreaterThanOrEqual(0.7);
  });
});

describe("resolveMatch", () => {
  it("reports not_found when there are no results", () => {
    expect(resolveMatch("Anything", [])).toEqual({ status: "not_found" });
  });

  it("verifies a clear single match", () => {
    const result = resolveMatch("Sagrada Familia", [place("Basílica de la Sagrada Família")]);
    expect(result.status).toBe("verified");
  });

  it("verifies when the top match clearly leads the rest", () => {
    const result = resolveMatch("Park Guell", [
      place("Park Güell"),
      place("Gaudí House Museum"),
    ]);
    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(result.place.name).toBe("Park Güell");
    }
  });

  // The whole point: near-ties are exactly when a human should decide.
  it("asks the user when two results score similarly", () => {
    const result = resolveMatch("Picasso Museum", [
      place("Museu Picasso", "Barcelona"),
      place("Picasso Museum", "Malaga"),
    ]);
    expect(result.status).toBe("ambiguous");
  });

  it("asks the user when nothing scores well", () => {
    const result = resolveMatch("Some Invented Cafe", [
      place("Central Library"),
      place("City Aquarium"),
    ]);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.alternates.length).toBeGreaterThan(0);
    }
  });

  it("caps the alternates it offers", () => {
    const result = resolveMatch(
      "Cafe",
      Array.from({ length: 12 }, (_, index) => place(`Unrelated Venue ${index}`)),
    );
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.alternates.length).toBeLessThanOrEqual(5);
    }
  });

  it("never silently picks when the choice is genuinely unclear", () => {
    const result = resolveMatch("Market", [
      place("La Boqueria Market"),
      place("Santa Caterina Market"),
      place("Sant Antoni Market"),
    ]);
    expect(result.status).toBe("ambiguous");
  });
});
