(() => {
  // src/shared.js
  var STORAGE_KEY_PROFILES = "ghActionsTreeProfiles";
  var GLOBAL_KEY = "__global__";
  var DEFAULT_RULES = [
    { type: "keyword", pattern: "Dependabot", label: "", parent: "" },
    { type: "keyword", pattern: "Copilot", label: "", parent: "" },
    { type: "keyword", pattern: "CodeQL", label: "", parent: "" },
    { type: "keyword", pattern: "Deploy", label: "", parent: "" },
    { type: "keyword", pattern: "Terraform", label: "", parent: "" },
    { type: "keyword", pattern: "Docker", label: "", parent: "" },
    { type: "keyword", pattern: "Security", label: "", parent: "" },
    { type: "keyword", pattern: "Lint", label: "", parent: "" },
    { type: "keyword", pattern: "Test", label: "", parent: "" },
    { type: "keyword", pattern: "Release", label: "", parent: "" },
    { type: "keyword", pattern: "CI", label: "", parent: "" },
    { type: "separator", pattern: ": ", label: "", parent: "" },
    { type: "separator", pattern: " : ", label: "", parent: "" },
    { type: "separator", pattern: " / ", label: "", parent: "" },
    { type: "separator", pattern: "/", label: "", parent: "" },
    { type: "separator", pattern: " :: ", label: "", parent: "" },
    { type: "separator", pattern: " - ", label: "", parent: "" }
  ];
  function parseRepoFromUrl(url) {
    try {
      const path = typeof url === "string" && url.startsWith("/") ? url : new URL(url).pathname;
      const m = path.match(/^\/([^/]+\/[^/]+)/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }
  function matchRule(name, rules) {
    for (const rule of rules) {
      if (!rule.pattern) continue;
      if (rule.type === "keyword") {
        if (name.toLowerCase().startsWith(rule.pattern.toLowerCase())) {
          const label = name.slice(rule.pattern.length).replace(/^[\s:\-/]+/, "").trim() || name;
          return { group: rule.label || rule.pattern, label, rule };
        }
      } else {
        if (name.includes(rule.pattern)) {
          const parts = name.split(rule.pattern).map((s) => s.trim()).filter(Boolean);
          if (parts.length >= 2) {
            return { group: rule.label || parts[0], label: parts.slice(1).join(" / "), rule };
          }
        }
      }
    }
    return { group: "Other", label: name, rule: null };
  }
  function getProfiles() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        [STORAGE_KEY_PROFILES, "rules", "keywords", "separators"],
        (data) => {
          if (data[STORAGE_KEY_PROFILES]) {
            resolve(data[STORAGE_KEY_PROFILES]);
            return;
          }
          let migrated = DEFAULT_RULES.map((r) => ({ ...r }));
          if (Array.isArray(data.rules) && data.rules.length > 0) {
            migrated = data.rules;
          } else if (Array.isArray(data.keywords) || Array.isArray(data.separators)) {
            migrated = [
              ...(data.keywords || []).map((p) => ({ type: "keyword", pattern: p, label: "" })),
              ...(data.separators || []).map((p) => ({ type: "separator", pattern: p, label: "" }))
            ];
          }
          resolve({ [GLOBAL_KEY]: { rules: migrated } });
        }
      );
    });
  }
  async function loadRulesForUrl(url) {
    const repo = parseRepoFromUrl(url);
    const profiles = await getProfiles();
    if (repo && profiles[repo]) return profiles[repo].rules;
    if (profiles[GLOBAL_KEY]) return profiles[GLOBAL_KEY].rules;
    return DEFAULT_RULES;
  }

  // src/content.js
  var EXTENSION_ROOT_ID = "gh-actions-tree-root";
  var HIDDEN_ATTR = "data-gh-actions-tree-hidden";
  var HIDDEN_DISPLAY_ATTR = "data-gh-actions-tree-prev-display";
  var STATE_KEY = "ghActionsTreeState";
  var isMounting = false;
  var activeRules = DEFAULT_RULES;
  var lastRepo = null;
  async function loadConfig() {
    activeRules = await loadRulesForUrl(location.href);
  }
  function isActionsPage() {
    return /\/actions(\/|$)/.test(location.pathname);
  }
  function getSidebarContainer() {
    return [...document.querySelectorAll("aside, nav, div")].find((el) => {
      const t = (el.innerText || "").toLowerCase();
      return t.includes("all workflows") && t.includes("management");
    }) || null;
  }
  function getAllWorkflowsAnchor(sidebar) {
    return [...sidebar.querySelectorAll("a")].find(
      (a) => (a.textContent || "").trim().toLowerCase() === "all workflows"
    ) || null;
  }
  function getWorkflowLinks(sidebar) {
    return [...sidebar.querySelectorAll('a[href*="/actions/workflows/"]')].filter((link) => {
      if (link.closest("#" + EXTENSION_ROOT_ID)) return false;
      if (!(link.getAttribute("href") || "").includes("/actions/workflows/")) return false;
      return !!(link.textContent || "").trim();
    });
  }
  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
    } catch {
      return {};
    }
  }
  function saveState(state) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }
  function createGroupHeader(groupName, count, expanded, onToggle) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gh-actions-tree-group";
    const chevron = document.createElement("span");
    chevron.className = "gh-actions-tree-chevron";
    chevron.textContent = expanded ? "\u25BE" : "\u25B8";
    const title = document.createElement("span");
    title.className = "gh-actions-tree-group-title";
    title.textContent = groupName;
    const badge = document.createElement("span");
    badge.className = "gh-actions-tree-count";
    badge.textContent = String(count);
    btn.append(chevron, title, badge);
    btn.addEventListener("click", () => onToggle(chevron));
    return btn;
  }
  function findHideTarget(link) {
    return link.closest("li") || link.parentElement;
  }
  function buildTree(workflowLinks) {
    const state = loadState();
    const grouped = /* @__PURE__ */ new Map();
    workflowLinks.forEach((link) => {
      const name = (link.textContent || "").trim().replace(/\s+/g, " ");
      const { group, label } = matchRule(name, activeRules);
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push({ link, fullName: name, label });
    });
    if (grouped.size === 0) return null;
    const parentOf = {};
    for (const rule of activeRules) {
      const name = rule.label || rule.pattern;
      if (rule.parent) parentOf[name] = rule.parent;
    }
    const ruleOrder = activeRules.map((r) => r.label || r.pattern);
    const sortedGrouped = new Map(
      [...grouped.entries()].sort(([a], [b]) => {
        if (a === "Other") return 1;
        if (b === "Other") return -1;
        const ai = ruleOrder.indexOf(a);
        const bi = ruleOrder.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      })
    );
    const root = document.createElement("div");
    root.id = EXTENSION_ROOT_ID;
    root.className = "gh-actions-tree";
    const sectionEls = /* @__PURE__ */ new Map();
    for (const [groupName, items] of sortedGrouped.entries()) {
      const section = document.createElement("div");
      section.className = "gh-actions-tree-section";
      const children = document.createElement("div");
      children.className = "gh-actions-tree-children";
      const expanded = state[groupName] !== false;
      if (!expanded) children.style.display = "none";
      const header = createGroupHeader(groupName, items.length, expanded, (chevron) => {
        const nowExpanded = children.style.display === "none";
        children.style.display = nowExpanded ? "" : "none";
        chevron.textContent = nowExpanded ? "\u25BE" : "\u25B8";
        const s = loadState();
        s[groupName] = nowExpanded;
        saveState(s);
      });
      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "gh-actions-tree-item";
        const clone = item.link.cloneNode(true);
        clone.classList.add("gh-actions-tree-link");
        clone.textContent = item.label;
        clone.title = item.fullName;
        row.appendChild(clone);
        children.appendChild(row);
        const hideTarget = findHideTarget(item.link);
        if (hideTarget && !hideTarget.hasAttribute(HIDDEN_ATTR)) {
          hideTarget.setAttribute(HIDDEN_ATTR, "true");
          hideTarget.setAttribute(HIDDEN_DISPLAY_ATTR, hideTarget.style.display || "");
          hideTarget.style.display = "none";
        }
      });
      section.appendChild(header);
      section.appendChild(children);
      sectionEls.set(groupName, { section, children });
    }
    for (const [groupName, { section }] of sectionEls.entries()) {
      const par = parentOf[groupName];
      if (par && sectionEls.has(par)) {
        const sub = document.createElement("div");
        sub.className = "gh-actions-tree-subgroup";
        sub.appendChild(section);
        sectionEls.get(par).children.appendChild(sub);
      } else {
        root.appendChild(section);
      }
    }
    return root;
  }
  function cleanupPrevious() {
    document.getElementById(EXTENSION_ROOT_ID)?.remove();
    document.querySelectorAll(`[${HIDDEN_ATTR}="true"]`).forEach((el) => {
      el.style.display = el.getAttribute(HIDDEN_DISPLAY_ATTR) || "";
      el.removeAttribute(HIDDEN_ATTR);
      el.removeAttribute(HIDDEN_DISPLAY_ATTR);
    });
  }
  function mount() {
    if (isMounting) return;
    isMounting = true;
    try {
      if (!isActionsPage()) {
        cleanupPrevious();
        return;
      }
      const sidebar = getSidebarContainer();
      if (!sidebar) return;
      const links = getWorkflowLinks(sidebar);
      if (links.length < 2) return;
      cleanupPrevious();
      const tree = buildTree(links);
      if (!tree) return;
      const anchor = getAllWorkflowsAnchor(sidebar);
      const insertAfter = anchor ? anchor.closest("li") || anchor.parentElement : null;
      if (insertAfter?.parentElement) {
        insertAfter.parentElement.insertBefore(tree, insertAfter.nextSibling);
      } else {
        sidebar.prepend(tree);
      }
    } finally {
      isMounting = false;
    }
  }
  var debounceTimer = null;
  function scheduleMount() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(mount, 250);
  }
  var observer = new MutationObserver(() => {
    if (!isMounting) scheduleMount();
  });
  async function init() {
    await loadConfig();
    lastRepo = parseRepoFromUrl(location.pathname);
    scheduleMount();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(async () => {
      const repo = parseRepoFromUrl(location.pathname);
      if (repo !== lastRepo) {
        lastRepo = repo;
        await loadConfig();
        scheduleMount();
      }
    }, 500);
  }
  init();
})();
