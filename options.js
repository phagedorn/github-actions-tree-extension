(() => {
  // src/shared.js
  var STORAGE_KEY_PROFILES = "ghActionsTreeProfiles";
  var GLOBAL_KEY = "__global__";
  var DEFAULT_RULES = [
    { type: "keyword", pattern: "TALIAS", label: "", parent: "" },
    { type: "keyword", pattern: "Dependabot", label: "", parent: "" },
    { type: "keyword", pattern: "Copilot", label: "", parent: "" },
    { type: "keyword", pattern: "CodeQL", label: "", parent: "" },
    { type: "keyword", pattern: "Deploy", label: "", parent: "" },
    { type: "keyword", pattern: "GGP", label: "", parent: "" },
    { type: "keyword", pattern: "ggp", label: "", parent: "" },
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
  function matchRule(name, rules2) {
    for (const rule of rules2) {
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
  function saveProfiles(profiles) {
    return new Promise(
      (resolve) => chrome.storage.sync.set({ [STORAGE_KEY_PROFILES]: profiles }, resolve)
    );
  }

  // src/options.js
  var allProfiles = {};
  var currentKey = GLOBAL_KEY;
  var rules = [];
  var dirty = false;
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function isInheriting() {
    return currentKey !== GLOBAL_KEY && !allProfiles[currentKey];
  }
  function globalRules() {
    return allProfiles[GLOBAL_KEY]?.rules ?? DEFAULT_RULES;
  }
  function profileDisplayHTML(key) {
    if (key === GLOBAL_KEY) return "Global";
    const [org, repo] = key.split("/");
    return repo ? `<span class="profile-org">${esc(org)}</span><span class="profile-slash">/</span><span class="profile-repo">${esc(repo)}</span>` : esc(key);
  }
  function renderProfileList() {
    const list = document.getElementById("profile-list");
    const keys = [GLOBAL_KEY, ...Object.keys(allProfiles).filter((k) => k !== GLOBAL_KEY).sort()];
    list.innerHTML = keys.map((key) => {
      const active = key === currentKey;
      const inheriting = key !== GLOBAL_KEY && !allProfiles[key];
      const icon = key === GLOBAL_KEY ? "\u{1F310}" : "\u{1F4C1}";
      const delBtn = key !== GLOBAL_KEY ? `<button class="btn-del-profile" data-key="${esc(key)}" title="Remove profile">\xD7</button>` : "";
      const badge = inheriting ? `<span class="inherit-indicator" title="Using global rules">global</span>` : "";
      return `<li class="profile-item${active ? " active" : ""}" data-key="${esc(key)}">
      <span class="profile-icon">${icon}</span>
      <span class="profile-name">${profileDisplayHTML(key)}</span>
      ${badge}${delBtn}
    </li>`;
    }).join("");
    list.querySelectorAll(".profile-item").forEach((li) => {
      li.addEventListener("click", (e) => {
        if (e.target.classList.contains("btn-del-profile")) return;
        if (dirty) saveCurrentRules(false);
        switchProfile(li.dataset.key);
      });
    });
    list.querySelectorAll(".btn-del-profile").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        if (!confirm(`Remove custom rules for "${key}"?
It will fall back to Global rules.`)) return;
        delete allProfiles[key];
        dirty = false;
        saveProfiles(allProfiles);
        if (currentKey === key) switchProfile(GLOBAL_KEY);
        else renderProfileList();
      });
    });
  }
  function switchProfile(key) {
    currentKey = key;
    if (key === GLOBAL_KEY) {
      rules = globalRules().map((r) => ({ ...r }));
    } else if (allProfiles[key]) {
      rules = allProfiles[key].rules.map((r) => ({ ...r }));
    } else {
      rules = null;
    }
    dirty = false;
    renderAll();
  }
  function renderAll() {
    renderProfileList();
    renderProfileHeader();
    renderRules();
    updatePreview();
  }
  function renderProfileHeader() {
    const heading = document.getElementById("profile-heading");
    const inheritCtrl = document.getElementById("inherit-controls");
    const inheritBadge = document.getElementById("inherit-badge");
    const customizeBtn = document.getElementById("customize-btn");
    const resetBtn = document.getElementById("reset-to-global-btn");
    const rulesCard = document.getElementById("rules-card");
    const addRow = document.getElementById("rules-add-row");
    const footer = document.getElementById("profile-footer");
    if (currentKey === GLOBAL_KEY) {
      heading.textContent = "Global";
      inheritCtrl.style.display = "none";
      rulesCard.classList.remove("card--disabled");
      addRow.style.display = "";
      footer.style.display = "";
    } else {
      heading.innerHTML = profileDisplayHTML(currentKey);
      inheritCtrl.style.display = "flex";
      if (isInheriting()) {
        inheritBadge.style.display = "";
        customizeBtn.style.display = "";
        resetBtn.style.display = "none";
        rulesCard.classList.add("card--disabled");
        addRow.style.display = "none";
        footer.style.display = "none";
        rules = globalRules().map((r) => ({ ...r }));
      } else {
        inheritBadge.style.display = "none";
        customizeBtn.style.display = "none";
        resetBtn.style.display = "";
        rulesCard.classList.remove("card--disabled");
        addRow.style.display = "";
        footer.style.display = "";
      }
    }
  }
  var dragIndex = null;
  function renderRules() {
    const list = document.getElementById("rules-list");
    const disabled = isInheriting();
    list.innerHTML = "";
    if (!rules || rules.length === 0) {
      list.innerHTML = `<div class="empty-state">No rules \u2014 Add one below.</div>`;
      return;
    }
    rules.forEach((rule, i) => {
      const row = document.createElement("div");
      row.className = "rule-row";
      row.innerHTML = `
      <div class="drag-handle" ${disabled ? 'style="opacity:0.3;cursor:default"' : ""}>\u283F</div>
      <div>
        <span class="type-badge type-${esc(rule.type)}" ${disabled ? "" : 'title="Click to toggle"'}>
          ${esc(rule.type)}
        </span>
      </div>
      <div>
        <input type="text" class="pattern-input" value="${esc(rule.pattern)}"
          placeholder="pattern" spellcheck="false" autocomplete="off" ${disabled ? "readonly" : ""}>
      </div>
      <div>
        <input type="text" class="label-input" value="${esc(rule.label)}"
          placeholder="${esc(rule.pattern || "display name")}" spellcheck="false" autocomplete="off" ${disabled ? "readonly" : ""}>
      </div>
      <div>${!disabled ? `<button class="btn-remove" title="Remove">\xD7</button>` : ""}</div>`;
      if (!disabled) {
        const handle = row.querySelector(".drag-handle");
        handle.addEventListener("mousedown", () => {
          row.draggable = true;
        });
        row.addEventListener("dragend", () => {
          row.draggable = false;
          row.classList.remove("dragging");
          document.querySelectorAll(".rule-row.drag-over").forEach((r) => r.classList.remove("drag-over"));
          dragIndex = null;
        });
        row.addEventListener("dragstart", (e) => {
          dragIndex = i;
          row.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
        });
        row.addEventListener("dragover", (e) => {
          e.preventDefault();
          document.querySelectorAll(".rule-row.drag-over").forEach((r) => r.classList.remove("drag-over"));
          row.classList.add("drag-over");
        });
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          row.classList.remove("drag-over");
          if (dragIndex === null || dragIndex === i) return;
          const [moved] = rules.splice(dragIndex, 1);
          rules.splice(i, 0, moved);
          dragIndex = null;
          dirty = true;
          renderRules();
          updatePreview();
        });
        row.querySelector(".type-badge").addEventListener("click", () => {
          rules[i].type = rules[i].type === "keyword" ? "separator" : "keyword";
          dirty = true;
          renderRules();
          updatePreview();
        });
        row.querySelector(".pattern-input").addEventListener("input", (e) => {
          rules[i].pattern = e.target.value;
          row.querySelector(".label-input").placeholder = e.target.value || "display name";
          dirty = true;
          updatePreview();
        });
        row.querySelector(".label-input").addEventListener("input", (e) => {
          rules[i].label = e.target.value;
          dirty = true;
          updatePreview();
        });
        row.querySelector(".btn-remove").addEventListener("click", () => {
          rules.splice(i, 1);
          dirty = true;
          renderRules();
          updatePreview();
        });
      }
      list.appendChild(row);
    });
    updateGroupPreview();
  }
  function updateGroupPreview() {
    const el = document.getElementById("hierarchy-body");
    if (!el) return;
    const activeRules = rules ?? globalRules();
    const disabled = isInheriting();
    if (!activeRules.length) {
      el.innerHTML = `<div class="hierarchy-empty">No rules defined \u2014 all workflows land in <em>Other</em></div>`;
      return;
    }
    const hint = disabled ? "" : `
    <div class="h-instructions">
      <span>\u283F drag to reorder</span>
      <span>\u2192 drag onto a group to nest inside it</span>
      <span>\u2190 click \u2190 to un-nest</span>
    </div>`;
    const ul = document.createElement("ul");
    ul.className = "h-list";
    activeRules.forEach((rule, idx) => {
      const groupName = rule.label || rule.pattern;
      const indent = rule.parent ? 1 : 0;
      const isSep = rule.type === "separator";
      const li = document.createElement("li");
      li.className = "h-item";
      li.dataset.idx = idx;
      li.dataset.indent = indent;
      const unindentBtn = indent > 0 && !disabled ? `<div class="h-unindent" data-idx="${idx}" title="Move out of subgroup">\u2190</div>` : "";
      li.innerHTML = `
      <div class="h-row${disabled ? "" : ""}" draggable="${!disabled}">
        <div class="h-drag-handle">\u283F</div>
        <div class="h-row-body">
          <span class="h-folder">\u{1F4C1}</span>
          <span class="h-name${isSep ? " h-name-dynamic" : ""}">${esc(groupName)}</span>
          <span class="h-pattern">${esc(rule.pattern)}</span>
          <span class="h-type${isSep ? " h-type-sep" : ""}">${esc(rule.type)}</span>
          ${rule.parent ? `<span style="font-size:10px;color:var(--fg-subtle)">in <strong>${esc(rule.parent)}</strong></span>` : ""}
        </div>
        ${unindentBtn}
      </div>`;
      ul.appendChild(li);
    });
    const otherLi = document.createElement("li");
    otherLi.innerHTML = `<div class="h-other-row"><span>\u{1F4C1}</span><span>Other \u2014 anything that didn't match a rule</span></div>`;
    ul.appendChild(otherLi);
    el.innerHTML = hint;
    el.appendChild(ul);
    if (disabled) return;
    let dragIdx = null;
    ul.querySelectorAll("li.h-item").forEach((li) => {
      const row = li.querySelector(".h-row");
      const idx = Number(li.dataset.idx);
      row.addEventListener("dragstart", (e) => {
        dragIdx = idx;
        row.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", idx);
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("is-dragging");
        ul.querySelectorAll(".drop-above,.drop-below,.drop-child").forEach((x) => {
          x.classList.remove("drop-above", "drop-below", "drop-child");
        });
      });
      li.addEventListener("dragover", (e) => {
        if (dragIdx === null || dragIdx === idx) return;
        e.preventDefault();
        ul.querySelectorAll(".drop-above,.drop-below,.drop-child").forEach((x) => {
          x.classList.remove("drop-above", "drop-below", "drop-child");
        });
        const rect = li.getBoundingClientRect();
        const yRel = e.clientY - rect.top;
        const zone = rect.height / 3;
        if (yRel < zone) {
          li.classList.add("drop-above");
        } else if (yRel > rect.height - zone) {
          li.classList.add("drop-below");
        } else {
          const targetRule = activeRules[idx];
          if (targetRule.type === "keyword") {
            li.classList.add("drop-child");
          } else {
            li.classList.add("drop-below");
          }
        }
      });
      li.addEventListener("dragleave", (e) => {
        if (!li.contains(e.relatedTarget)) {
          li.classList.remove("drop-above", "drop-below", "drop-child");
        }
      });
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragIdx === null || dragIdx === idx) return;
        const targetRule = activeRules[idx];
        const movedRule = rules.splice(dragIdx, 1)[0];
        if (li.classList.contains("drop-child")) {
          movedRule.parent = targetRule.label || targetRule.pattern;
          const insertAt = rules.indexOf(targetRule) + 1;
          rules.splice(insertAt, 0, movedRule);
        } else {
          let insertAt = rules.indexOf(targetRule);
          if (li.classList.contains("drop-below")) insertAt += 1;
          if (li.classList.contains("drop-above") && movedRule.parent) movedRule.parent = "";
          if (li.classList.contains("drop-below") && movedRule.parent) movedRule.parent = "";
          rules.splice(insertAt, 0, movedRule);
        }
        li.classList.remove("drop-above", "drop-below", "drop-child");
        dragIdx = null;
        dirty = true;
        renderRules();
        updatePreview();
      });
    });
    ul.querySelectorAll(".h-unindent").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        rules[idx].parent = "";
        dirty = true;
        renderRules();
        updatePreview();
      });
    });
  }
  function updatePreview() {
    const name = (document.getElementById("preview-input").value || "").trim();
    const el = document.getElementById("preview-result");
    if (!name) {
      el.innerHTML = "";
      return;
    }
    const effectiveRules = rules ?? globalRules();
    const { group, label, rule } = matchRule(name, effectiveRules);
    const meta = rule ? `Matched <strong>${esc(rule.type)}</strong> rule <code>${esc(rule.pattern)}</code>${rule.label ? ` \u2192 displayed as <code>${esc(rule.label)}</code>` : ""}` : `No rule matched \u2014 falls into <strong>Other</strong>`;
    el.innerHTML = `
    <div class="preview-match">
      <span class="preview-group">${esc(group)}</span>
      <span class="preview-sep">\u203A</span>
      <span class="preview-label">${esc(label)}</span>
    </div>
    <div class="preview-meta">${meta}</div>`;
  }
  function addRule() {
    const type = document.getElementById("add-type").value;
    const pattern = document.getElementById("add-pattern").value.trim();
    const label = document.getElementById("add-label").value.trim();
    if (!pattern) {
      document.getElementById("add-pattern").focus();
      return;
    }
    rules.push({ type, pattern, label, parent: "" });
    dirty = true;
    document.getElementById("add-pattern").value = "";
    document.getElementById("add-label").value = "";
    renderRules();
    updatePreview();
    document.getElementById("rules-list").lastElementChild?.scrollIntoView({ block: "nearest" });
  }
  function saveCurrentRules(showStatus = true) {
    if (isInheriting()) return;
    allProfiles[currentKey] = { rules: rules.map((r) => ({ ...r })) };
    dirty = false;
    saveProfiles(allProfiles);
    if (showStatus) {
      const s = document.getElementById("status");
      s.textContent = "\u2713 Saved";
      s.className = "ok";
      setTimeout(() => {
        s.textContent = "";
        s.className = "";
      }, 2e3);
    }
  }
  function addProfileDirect(key) {
    if (!key || !key.includes("/")) return;
    if (dirty) saveCurrentRules(false);
    currentKey = key;
    rules = allProfiles[key] ? allProfiles[key].rules.map((r) => ({ ...r })) : null;
    dirty = false;
    renderAll();
  }
  function promptAddProfile(prefill = "") {
    const input = prompt("Enter repo (owner/repo):", prefill || "");
    if (!input) return;
    const key = input.trim().replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
    if (!key.includes("/")) {
      alert("Invalid format \u2014 use: owner/repo");
      return;
    }
    if (currentKey !== key) {
      if (dirty) saveCurrentRules(false);
      currentKey = key;
      rules = null;
      dirty = false;
      renderAll();
    }
  }
  document.getElementById("add-btn").addEventListener("click", addRule);
  document.getElementById("add-pattern").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addRule();
  });
  document.getElementById("preview-input").addEventListener("input", updatePreview);
  document.getElementById("save-btn").addEventListener("click", () => saveCurrentRules(true));
  document.getElementById("reset-btn").addEventListener("click", () => {
    if (!confirm("Reset this profile to default rules?")) return;
    rules = DEFAULT_RULES.map((r) => ({ ...r }));
    dirty = true;
    renderRules();
    updatePreview();
  });
  document.getElementById("add-profile-btn").addEventListener("click", () => promptAddProfile());
  document.getElementById("customize-btn").addEventListener("click", () => {
    rules = globalRules().map((r) => ({ ...r }));
    allProfiles[currentKey] = { rules: rules.map((r) => ({ ...r })) };
    dirty = true;
    renderAll();
  });
  document.getElementById("reset-to-global-btn").addEventListener("click", () => {
    if (!confirm(`Remove custom rules for "${currentKey}" and fall back to Global?`)) return;
    delete allProfiles[currentKey];
    dirty = false;
    saveProfiles(allProfiles);
    rules = null;
    renderAll();
  });
  document.getElementById("export-btn").addEventListener("click", () => {
    const filename = currentKey === GLOBAL_KEY ? "global" : currentKey.replace("/", "--");
    const blob = new Blob(
      [JSON.stringify({ profile: currentKey, rules: rules ?? globalRules() }, null, 2)],
      { type: "application/json" }
    );
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `gh-tree-${filename}.json`
    });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById("import-btn").addEventListener("click", () => document.getElementById("import-file").click());
  document.getElementById("import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data.rules)) {
          alert("Expected { rules: [...] }");
          return;
        }
        rules = data.rules.filter((r) => r.type && r.pattern).map((r) => ({ type: r.type === "separator" ? "separator" : "keyword", pattern: String(r.pattern), label: String(r.label || ""), parent: String(r.parent || "") }));
        dirty = true;
        renderRules();
        updatePreview();
      } catch {
        alert("Failed to parse JSON.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });
  function applyCurrentRepo(repo) {
    if (!repo) return;
    const hint = document.getElementById("current-tab-hint");
    hint.style.display = "flex";
    hint.innerHTML = `
    <span>Current tab: <strong>${esc(repo)}</strong></span>
    <button id="jump-btn" class="btn-io">Configure this repo</button>`;
    document.getElementById("jump-btn").addEventListener("click", () => promptAddProfile(repo));
    const btn = document.getElementById("add-current-repo-btn");
    const label = document.getElementById("add-current-repo-label");
    const [org, repoName] = repo.split("/");
    label.innerHTML = `<span style="opacity:0.75">${esc(org)}/</span>${esc(repoName)}`;
    btn.title = `Switch to / create profile for "${repo}"`;
    btn.style.display = "flex";
    btn.addEventListener("click", () => addProfileDirect(repo));
  }
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const repo = parseRepoFromUrl(tabs[0]?.url || "");
    if (repo) {
      applyCurrentRepo(repo);
      return;
    }
    chrome.tabs.query({}, (allTabs) => {
      const hit = allTabs.filter((t) => t.url && !t.url.startsWith("chrome-extension://")).map((t) => ({ repo: parseRepoFromUrl(t.url), lastAccessed: t.lastAccessed ?? 0 })).filter((t) => t.repo).sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
      if (hit) applyCurrentRepo(hit.repo);
    });
  });
  async function init() {
    allProfiles = await getProfiles();
    if (!allProfiles[GLOBAL_KEY]) {
      allProfiles[GLOBAL_KEY] = { rules: DEFAULT_RULES.map((r) => ({ ...r })) };
    }
    switchProfile(GLOBAL_KEY);
  }
  init();
})();
