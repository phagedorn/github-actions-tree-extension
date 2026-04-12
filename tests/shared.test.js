/**
 * Unit tests for src/shared.js
 * Run:  npm test
 */
import { describe, it, expect } from "vitest";
import { matchRule, parseRepoFromUrl } from "../src/shared.js";

// ─── parseRepoFromUrl ──────────────────────────────────────────────────────

describe("parseRepoFromUrl", () => {
  it("extracts owner/repo from a full GitHub URL", () => {
    expect(parseRepoFromUrl("https://github.com/acme/my-repo/actions")).toBe("acme/my-repo");
  });

  it("extracts owner/repo from a pathname", () => {
    expect(parseRepoFromUrl("/acme/my-repo/actions/workflows/ci.yml")).toBe("acme/my-repo");
  });

  it("extracts owner/repo from the root path", () => {
    expect(parseRepoFromUrl("https://github.com/acme/my-repo")).toBe("acme/my-repo");
  });

  it("returns null for a bare domain", () => {
    expect(parseRepoFromUrl("https://github.com/")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseRepoFromUrl("")).toBeNull();
  });

  it("handles enterprise GitHub domains", () => {
    expect(parseRepoFromUrl("https://github.company.com/org/repo/actions")).toBe("org/repo");
  });
});

// ─── matchRule — keyword rules ─────────────────────────────────────────────

describe("matchRule — keyword", () => {
  const rules = [
    { type: "keyword", pattern: "TALIAS", label: "",        parent: "" },
    { type: "keyword", pattern: "Deploy", label: "Deploys", parent: "" },
  ];

  it("matches a workflow that starts with the keyword (exact case)", () => {
    const r = matchRule("TALIAS: Validate Functions", rules);
    expect(r.group).toBe("TALIAS");
    expect(r.rule).toBe(rules[0]);
  });

  it("is case-insensitive", () => {
    const r = matchRule("talias: validate functions", rules);
    expect(r.group).toBe("TALIAS");
  });

  it("strips the keyword prefix from the label", () => {
    const r = matchRule("TALIAS: Validate Functions", rules);
    expect(r.label).toBe("Validate Functions");
  });

  it("uses display label from rule when set", () => {
    const r = matchRule("Deploy production", rules);
    expect(r.group).toBe("Deploys");
  });

  it("falls through to Other when nothing matches", () => {
    const r = matchRule("My random workflow", rules);
    expect(r.group).toBe("Other");
    expect(r.label).toBe("My random workflow");
    expect(r.rule).toBeNull();
  });

  it("does not match a keyword mid-string", () => {
    const r = matchRule("Run TALIAS check", rules);
    expect(r.group).toBe("Other");
  });

  it("returns full name as label when nothing follows the keyword", () => {
    const r = matchRule("TALIAS", rules);
    expect(r.label).toBe("TALIAS");
  });
});

// ─── matchRule — separator rules ───────────────────────────────────────────

describe("matchRule — separator", () => {
  const rules = [
    { type: "separator", pattern: ": ",  label: "",       parent: "" },
    { type: "separator", pattern: " / ", label: "Slash",  parent: "" },
  ];

  it("splits on separator and uses text before as group", () => {
    const r = matchRule("TALIAS: Validate Functions", rules);
    expect(r.group).toBe("TALIAS");
    expect(r.label).toBe("Validate Functions");
  });

  it("uses display label from rule when set", () => {
    const r = matchRule("Deploy / production", rules);
    expect(r.group).toBe("Slash");
    expect(r.label).toBe("production");
  });

  it("falls to Other when separator not present", () => {
    const r = matchRule("Plain workflow", rules);
    expect(r.group).toBe("Other");
  });

  it("joins multiple parts with ' / ' when separator appears more than once", () => {
    const r = matchRule("A: B: C", rules);
    expect(r.group).toBe("A");
    expect(r.label).toBe("B / C");
  });
});

// ─── matchRule — rule order (first match wins) ─────────────────────────────

describe("matchRule — first match wins", () => {
  const rules = [
    { type: "keyword",   pattern: "Deploy",  label: "Keyword Deploy",   parent: "" },
    { type: "separator", pattern: ": ",      label: "",                 parent: "" },
  ];

  it("keyword rule beats separator when both could match", () => {
    // "Deploy: prod" starts with "Deploy" → keyword wins
    const r = matchRule("Deploy: prod", rules);
    expect(r.group).toBe("Keyword Deploy");
  });

  it("separator wins when keyword does not match", () => {
    const r = matchRule("Build: prod", rules);
    expect(r.group).toBe("Build");
  });
});

// ─── matchRule — edge cases ────────────────────────────────────────────────

describe("matchRule — edge cases", () => {
  it("handles empty rules array", () => {
    const r = matchRule("Any workflow", []);
    expect(r.group).toBe("Other");
  });

  it("skips rules with empty pattern", () => {
    const rules = [{ type: "keyword", pattern: "", label: "", parent: "" }];
    const r = matchRule("Anything", rules);
    expect(r.group).toBe("Other");
  });

  it("handles empty workflow name", () => {
    const rules = [{ type: "keyword", pattern: "CI", label: "", parent: "" }];
    const r = matchRule("", rules);
    expect(r.group).toBe("Other");
  });
});
