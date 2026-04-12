export const STORAGE_KEY_PROFILES = "ghActionsTreeProfiles";
export const GLOBAL_KEY           = "__global__";

export const DEFAULT_RULES = [
  { type: "keyword",   pattern: "Dependabot", label: "", parent: "" },
  { type: "keyword",   pattern: "Copilot",    label: "", parent: "" },
  { type: "keyword",   pattern: "CodeQL",     label: "", parent: "" },
  { type: "keyword",   pattern: "Deploy",     label: "", parent: "" },
  { type: "keyword",   pattern: "Terraform",  label: "", parent: "" },
  { type: "keyword",   pattern: "Docker",     label: "", parent: "" },
  { type: "keyword",   pattern: "Security",   label: "", parent: "" },
  { type: "keyword",   pattern: "Lint",       label: "", parent: "" },
  { type: "keyword",   pattern: "Test",       label: "", parent: "" },
  { type: "keyword",   pattern: "Release",    label: "", parent: "" },
  { type: "keyword",   pattern: "CI",         label: "", parent: "" },
  { type: "separator", pattern: ": ",         label: "", parent: "" },
  { type: "separator", pattern: " : ",        label: "", parent: "" },
  { type: "separator", pattern: " / ",        label: "", parent: "" },
  { type: "separator", pattern: "/",          label: "", parent: "" },
  { type: "separator", pattern: " :: ",       label: "", parent: "" },
  { type: "separator", pattern: " - ",        label: "", parent: "" },
];

/** Extract "owner/repo" from any GitHub URL or pathname. */
export function parseRepoFromUrl(url) {
  try {
    const path = typeof url === "string" && url.startsWith("/")
      ? url
      : new URL(url).pathname;
    const m = path.match(/^\/([^/]+\/[^/]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

/** Return the first matching rule result for a workflow name. */
export function matchRule(name, rules) {
  for (const rule of rules) {
    if (!rule.pattern) continue;
    if (rule.type === "keyword") {
      if (name.toLowerCase().startsWith(rule.pattern.toLowerCase())) {
        const label = name.slice(rule.pattern.length).replace(/^[\s:\-/]+/, "").trim() || name;
        return { group: rule.label || rule.pattern, label, rule };
      }
    } else {
      if (name.includes(rule.pattern)) {
        const parts = name.split(rule.pattern).map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
          return { group: rule.label || parts[0], label: parts.slice(1).join(" / "), rule };
        }
      }
    }
  }
  return { group: "Other", label: name, rule: null };
}

/** Load all profiles from storage, migrating legacy formats if needed. */
export function getProfiles() {
  return new Promise(resolve => {
    chrome.storage.sync.get(
      [STORAGE_KEY_PROFILES, "rules", "keywords", "separators"],
      data => {
        if (data[STORAGE_KEY_PROFILES]) { resolve(data[STORAGE_KEY_PROFILES]); return; }

        // Migrate legacy formats
        let migrated = DEFAULT_RULES.map(r => ({ ...r }));
        if (Array.isArray(data.rules) && data.rules.length > 0) {
          migrated = data.rules;
        } else if (Array.isArray(data.keywords) || Array.isArray(data.separators)) {
          migrated = [
            ...(data.keywords   || []).map(p => ({ type: "keyword",   pattern: p, label: "" })),
            ...(data.separators || []).map(p => ({ type: "separator", pattern: p, label: "" })),
          ];
        }
        resolve({ [GLOBAL_KEY]: { rules: migrated } });
      }
    );
  });
}

/** Persist all profiles to storage. */
export function saveProfiles(profiles) {
  return new Promise(resolve =>
    chrome.storage.sync.set({ [STORAGE_KEY_PROFILES]: profiles }, resolve)
  );
}

/**
 * Resolve the active rules for a given URL:
 *  1. Repo-specific profile if it exists
 *  2. Global profile if it exists
 *  3. Built-in defaults
 */
export async function loadRulesForUrl(url) {
  const repo = parseRepoFromUrl(url);
  const profiles = await getProfiles();
  if (repo && profiles[repo])         return profiles[repo].rules;
  if (profiles[GLOBAL_KEY])           return profiles[GLOBAL_KEY].rules;
  return DEFAULT_RULES;
}
