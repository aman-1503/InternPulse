import { describe, expect, it } from "vitest";
import { deriveHandle, parseMentions } from "./mentions";

const members = [
  { userId: "u-alice", handle: deriveHandle("Alice Chen"), displayName: "Alice Chen" },
  { userId: "u-mia", handle: deriveHandle("Mia Rivera"), displayName: "Mia Rivera" },
  { userId: "u-jordan", handle: deriveHandle("Jordan Park"), displayName: "Jordan Park" },
];

describe("deriveHandle", () => {
  it("collapses to lowercase alphanumeric", () => {
    expect(deriveHandle("Alice Chen")).toBe("alicechen");
    expect(deriveHandle("Jordan Park")).toBe("jordanpark");
  });
});

describe("parseMentions", () => {
  it("matches a single mention", () => {
    expect(parseMentions("hey @AliceChen can you look?", members)).toEqual(["u-alice"]);
  });

  it("matches multiple distinct mentions", () => {
    const found = parseMentions("@AliceChen and @MiaRivera please review", members);
    expect(found.sort()).toEqual(["u-alice", "u-mia"].sort());
  });

  it("ignores an invalid/unknown mention (no external users)", () => {
    expect(parseMentions("cc @SomeRandomPerson", members)).toEqual([]);
  });

  it("still returns a self-mention (caller decides whether to notify)", () => {
    expect(parseMentions("noting for myself @AliceChen", members)).toEqual(["u-alice"]);
  });

  it("dedupes the same mention repeated in one message", () => {
    expect(parseMentions("@AliceChen ping @AliceChen again", members)).toEqual(["u-alice"]);
  });

  it("is case-insensitive", () => {
    expect(parseMentions("@alicechen", members)).toEqual(["u-alice"]);
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(parseMentions("", members)).toEqual([]);
    expect(parseMentions("   ", members)).toEqual([]);
  });

  it("also matches the natural '@Full Name' form (with a space)", () => {
    expect(parseMentions("cc @Mia Rivera on this", members)).toEqual(["u-mia"]);
  });

  it("does not let a shorter name shadow a longer overlapping one", () => {
    const withOverlap = [...members, { userId: "u-alicechenoye", handle: "alicechenoye", displayName: "Alice Chen Oye" }];
    expect(parseMentions("@AliceChenOye", withOverlap)).toEqual(["u-alicechenoye"]);
  });
});
