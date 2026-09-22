import { describe, expect, it } from "vitest";
import type { WorkspaceMember } from "../../shared/protocol";
import { parseMentions } from "../../shared/mentions";
import { detectMentionTrigger, filterMentionCandidates, mentionInsertionText } from "./mentionMatch";

const MEMBERS: WorkspaceMember[] = [
  { userId: "u1", displayName: "Test Mentor", role: "mentor", handle: "testmentor" },
  { userId: "u2", displayName: "Test Manager", role: "manager", handle: "testmanager" },
  { userId: "u3", displayName: "Alice Chen", role: "intern", handle: "alicechen" },
];

describe("detectMentionTrigger", () => {
  it("detects a bare '@' at the caret as an empty-query trigger", () => {
    expect(detectMentionTrigger("hello @", 7)).toEqual({ at: 6, query: "" });
  });

  it("detects a partial name typed after '@'", () => {
    const text = "please loop in @Te";
    expect(detectMentionTrigger(text, text.length)).toEqual({ at: 15, query: "Te" });
  });

  it("detects a multi-word partial name (space doesn't end the trigger by itself)", () => {
    const text = "cc @Test Ment";
    expect(detectMentionTrigger(text, text.length)).toEqual({ at: 3, query: "Test Ment" });
  });

  it("returns null once the token has a trailing space (name typed out fully, no longer 'live')", () => {
    const text = "cc @Test Mentor ";
    expect(detectMentionTrigger(text, text.length)).toBeNull();
  });

  it("returns null with no '@' before the caret at all", () => {
    expect(detectMentionTrigger("no at sign here", 10)).toBeNull();
  });

  it("returns null across a newline (an '@' from a previous line shouldn't still trigger)", () => {
    const text = "@old line\nnew line";
    expect(detectMentionTrigger(text, text.length)).toBeNull();
  });

  it("uses the caret position, not the end of the string (mid-text editing)", () => {
    const text = "@Alice hello world";
    // caret right after "@Alice" (position 6), before the trailing text
    expect(detectMentionTrigger(text, 6)).toEqual({ at: 0, query: "Alice" });
  });

  it("returns null once the partial token grows unreasonably long", () => {
    const text = "@" + "x".repeat(41);
    expect(detectMentionTrigger(text, text.length)).toBeNull();
  });
});

describe("filterMentionCandidates", () => {
  it("matches every member on an empty query (right after typing bare '@')", () => {
    expect(filterMentionCandidates(MEMBERS, "")).toHaveLength(3);
  });

  it("is case-insensitive and matches by substring anywhere in the display name", () => {
    expect(filterMentionCandidates(MEMBERS, "mentor").map((m) => m.userId)).toEqual(["u1"]);
    expect(filterMentionCandidates(MEMBERS, "TEST").map((m) => m.userId)).toEqual(["u1", "u2"]);
  });

  it("returns nothing for a query matching no one", () => {
    expect(filterMentionCandidates(MEMBERS, "zzz")).toHaveLength(0);
  });
});

describe("mentionInsertionText + parseMentions round-trip", () => {
  it("the inserted form is recognized by the shared mention parser", () => {
    const inserted = mentionInsertionText(MEMBERS[0]);
    expect(inserted).toBe("@Test Mentor ");
    const text = `please see ${inserted}about this`;
    expect(parseMentions(text, MEMBERS)).toEqual([MEMBERS[0].userId]);
  });

  it("round-trips through the full detect -> filter -> insert -> parse flow", () => {
    const draft = "cc @Test Ment";
    const trigger = detectMentionTrigger(draft, draft.length)!;
    const candidates = filterMentionCandidates(MEMBERS, trigger.query);
    expect(candidates.map((m) => m.userId)).toEqual(["u1"]);
    const picked = candidates[0];
    const before = draft.slice(0, trigger.at);
    const finalText = before + mentionInsertionText(picked) + "";
    expect(finalText).toBe("cc @Test Mentor ");
    expect(parseMentions(finalText, MEMBERS)).toEqual([picked.userId]);
  });
});
