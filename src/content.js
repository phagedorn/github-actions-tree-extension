import { DEFAULT_RULES, matchRule, loadRulesForUrl, parseRepoFromUrl } from "./shared.js";

// ── Constants ─────────────────────────────────────────────────────────
const EXTENSION_ROOT_ID  = "gh-actions-tree-root";
const HIDDEN_ATTR        = "data-gh-actions-tree-hidden";
const HIDDEN_DISPLAY_ATTR = "data-gh-actions-tree-prev-display";
const STATE_KEY          = "ghActionsTreeState";

// ── State ─────────────────────────────────────────────────────────────
let isMounting  = false;
let activeRules = DEFAULT_RULES;
let lastRepo    = null;

// ── Config loading ────────────────────────────────────────────────────
async function loadConfig() {
  activeRules = await loadRulesForUrl(location.href);
}

// ── Page detection ────────────────────────────────────────────────────
function isActionsPage() {
  return /\/actions(\/|$)/.test(location.pathname);
}

function getSidebarContainer() {
  return [...document.querySelectorAll("aside, nav, div")].find(el => {
    const t = (el.innerText || "").toLowerCase();
    return t.includes("all workflows") && t.includes("management");
  }) || null;
}

function getAllWorkflowsAnchor(sidebar) {
  return [...sidebar.querySelectorAll("a")].find(a =>
    (a.textContent || "").trim().toLowerCase() === "all workflows"
  ) || null;
}

function getWorkflowLinks(sidebar) {
  return [...sidebar.querySelectorAll('a[href*="/actions/workflows/"]')].filter(link => {
    if (link.closest("#" + EXTENSION_ROOT_ID)) return false;
    if (!(link.getAttribute("href") || "").includes("/actions/workflows/")) return false;
    return !!(link.textContent || "").trim();
  });
}

// ── Tree state ────────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || "{}"); }
  catch { return {}; }
}

function saveState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

// ── Tree rendering ────────────────────────────────────────────────────
function createGroupHeader(groupName, count, expanded, onToggle) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "gh-actions-tree-group";

  const chevron = document.createElement("span");
  chevron.className = "gh-actions-tree-chevron";
  chevron.textContent = expanded ? "▾" : "▸";

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
  const state   = loadState();
  const grouped = new Map();

  workflowLinks.forEach(link => {
    const name = (link.textContent || "").trim().replace(/\s+/g, " ");
    const { group, label } = matchRule(name, activeRules);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push({ link, fullName: name, label });
  });

  if (grouped.size === 0) return null;

  // Build a map of groupName → parent groupName from rules
  const parentOf = {};
  for (const rule of activeRules) {
    const name = rule.label || rule.pattern;
    if (rule.parent) parentOf[name] = rule.parent;
  }

  // Sort all groups in rule-defined order; "Other" always last
  const ruleOrder = activeRules.map(r => r.label || r.pattern);
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

  // Two-pass: first create all section elements, then attach children to parents
  const sectionEls = new Map(); // groupName → { section, children }

  for (const [groupName, items] of sortedGrouped.entries()) {
    const section  = document.createElement("div");
    section.className = "gh-actions-tree-section";

    const children = document.createElement("div");
    children.className = "gh-actions-tree-children";

    const expanded = state[groupName] !== false;
    if (!expanded) children.style.display = "none";

    const header = createGroupHeader(groupName, items.length, expanded, (chevron) => {
      const nowExpanded = children.style.display === "none";
      children.style.display = nowExpanded ? "" : "none";
      chevron.textContent = nowExpanded ? "▾" : "▸";
      const s = loadState();
      s[groupName] = nowExpanded;
      saveState(s);
    });

    items.forEach(item => {
      const row   = document.createElement("div");
      row.className = "gh-actions-tree-item";

      const clone = item.link.cloneNode(true);
      clone.classList.add("gh-actions-tree-link");
      clone.textContent = item.label;
      clone.title       = item.fullName;
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

  // Attach sections to root or as subgroups under their parent
  for (const [groupName, { section }] of sectionEls.entries()) {
    const par = parentOf[groupName];
    if (par && sectionEls.has(par)) {
      // Nest inside parent's children container, wrapped in subgroup class
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
  document.querySelectorAll(`[${HIDDEN_ATTR}="true"]`).forEach(el => {
    el.style.display = el.getAttribute(HIDDEN_DISPLAY_ATTR) || "";
    el.removeAttribute(HIDDEN_ATTR);
    el.removeAttribute(HIDDEN_DISPLAY_ATTR);
  });
}

// ── Mount ─────────────────────────────────────────────────────────────
function mount() {
  if (isMounting) return;
  isMounting = true;
  try {
    if (!isActionsPage()) { cleanupPrevious(); return; }
    const sidebar = getSidebarContainer();
    if (!sidebar) return;
    const links = getWorkflowLinks(sidebar);
    if (links.length < 2) return;
    cleanupPrevious();
    const tree = buildTree(links);
    if (!tree) return;
    const anchor      = getAllWorkflowsAnchor(sidebar);
    const insertAfter = anchor ? (anchor.closest("li") || anchor.parentElement) : null;
    if (insertAfter?.parentElement) {
      insertAfter.parentElement.insertBefore(tree, insertAfter.nextSibling);
    } else {
      sidebar.prepend(tree);
    }
  } finally {
    isMounting = false;
  }
}

let debounceTimer = null;
function scheduleMount() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(mount, 250);
}

const observer = new MutationObserver(() => { if (!isMounting) scheduleMount(); });

// ── Init ──────────────────────────────────────────────────────────────
async function init() {
  await loadConfig();
  lastRepo = parseRepoFromUrl(location.pathname);
  scheduleMount();

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Reload config when navigating to a different repo (GitHub is a SPA)
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
