const API = "https://gtm-audit-backend-8q9x.onrender.com";

// Helper to fetch data
async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  return res.json();
}

// 1. Login Button
document.getElementById("login").addEventListener('click', () => {
  chrome.tabs.create({ url: `${API}/auth` });
});

// 2. Data Loaders (Accounts/Containers/Workspaces)
async function loadAccounts() {
  const select = document.getElementById("accounts");
  const output = document.getElementById("output");
  select.innerHTML = "<option>Loading...</option>";
  
  try {
    const data = await fetchJSON(`${API}/gtm/accounts`);
    let list = data.account || (Array.isArray(data) ? data : []);
    
    if (data.error) {
       select.innerHTML = "<option>⚠️ Login Required</option>";
       output.textContent = "Please connect to Google.";
       return;
    }
    
    select.innerHTML = "<option value=''>-- Select Account --</option>";
    list.forEach(acc => select.add(new Option(acc.name, acc.accountId)));
    output.textContent = "Ready to audit.";
  } catch (e) {
    select.innerHTML = "<option>❌ Connection Failed</option>";
  }
}

document.getElementById("accounts").addEventListener('change', async (e) => {
  const select = document.getElementById("containers");
  select.innerHTML = "<option>Loading...</option>";
  const data = await fetchJSON(`${API}/gtm/containers/${e.target.value}`);
  const list = data.container || (Array.isArray(data) ? data : []);
  select.innerHTML = "";
  list.forEach(c => select.add(new Option(c.name, c.containerId)));
  if(list.length) select.dispatchEvent(new Event('change'));
});

document.getElementById("containers").addEventListener('change', async (e) => {
  const accId = document.getElementById("accounts").value;
  const select = document.getElementById("workspaces");
  select.innerHTML = "<option>Loading...</option>";
  const data = await fetchJSON(`${API}/gtm/workspaces/${accId}/${e.target.value}`);
  const list = data.workspace || (Array.isArray(data) ? data : []);
  select.innerHTML = "";
  list.forEach(w => select.add(new Option(w.name, w.workspaceId)));
});

// ==========================================
// 🧠 THE CORE AUDIT ENGINE (The 7 Pillars)
// ==========================================

function runAudit(data, workspaceMeta) {
  const issues = [];
  const tags = data.tags || [];
  const triggers = data.triggers || [];
  const variables = data.variables || [];

  // Helper to add issues
  const report = (severity, category, message, itemName = "") => {
    issues.push({ severity, category, message, itemName });
  };

  // Pillar 1: Hygiene
  if (workspaceMeta.totalWorkspaces > 3) {
    report("warning", "Hygiene", `${workspaceMeta.totalWorkspaces} active workspaces found. High risk of conflicts.`);
  }
  if (workspaceMeta.currentName === "Default Workspace") {
    report("warning", "Hygiene", "Workspace is named 'Default Workspace'. Rename to describe changes.");
  }

  // Pillar 2: Tag Audit
  const usedTriggers = new Set();
  const marketingPrefixes = ["GA4", "ADS", "META", "FB", "CAPI", "TIKTOK", "LNK", "INSIGHT"];
  const tagSignatures = {}; 

  tags.forEach(tag => {
    // Ghost Tags
    if (!tag.firingTriggerId || tag.firingTriggerId.length === 0) {
      report("error", "Tags", "Tag has no triggers (Ghost Tag)", tag.name);
    } else {
      tag.firingTriggerId.forEach(id => usedTriggers.add(id));
    }
    // Paused
    if (tag.paused) {
      report("info", "Tags", "Tag is paused", tag.name);
    }
    // Duplicates
    if (tag.firingTriggerId && tag.firingTriggerId.length > 0) {
      const sig = `${tag.type}-${tag.firingTriggerId.sort().join(',')}`;
      if (tagSignatures[sig]) {
         report("warning", "Tags", `Potential duplicate of "${tagSignatures[sig]}"`, tag.name);
      }
      tagSignatures[sig] = tag.name;
    }
    // Consent
    const isMarketing = marketingPrefixes.some(p => tag.name.toUpperCase().includes(p));
    if (isMarketing && !JSON.stringify(tag).includes("consentSettings")) {
       report("error", "Consent", "Marketing tag likely missing Consent Mode v2", tag.name);
    }
  });

  // Pillar 3: Triggers
  triggers.forEach(trig => {
    if (!usedTriggers.has(trig.triggerId)) {
      report("warning", "Triggers", "Trigger is not used by any tag", trig.name);
    }
  });

  // Pillar 4: Variables
  const allConfigString = JSON.stringify(tags) + JSON.stringify(triggers);
  variables.forEach(v => {
    if (!allConfigString.includes(v.name)) {
      report("warning", "Variables", "Variable appears unused", v.name);
    }
    if (v.type === "dom") {
      report("warning", "Variables", "Avoid DOM Element variables (fragile)", v.name);
    }
  });

  // Pillar 5: GA4
  const ga4Configs = tags.filter(t => t.type === "gaawc" || t.type === "googtag");
  if (ga4Configs.length > 1) {
    report("error", "GA4", `Multiple GA4 Config tags found (${ga4Configs.length})`);
  }
  
  // Pillar 6: Naming
  tags.forEach(tag => {
    if (!/^[A-Z0-9]+/.test(tag.name)) {
      report("info", "Naming", "Tag name does not start with a standard prefix", tag.name);
    }
  });

  // Pillar 7: Security
  tags.filter(t => t.type === "html").forEach(t => {
    const code = JSON.stringify(t.parameter);
    if (code.includes("document.write")) {
      report("error", "Security", "Contains 'document.write' (Performance/Security Risk)", t.name);
    }
    if (code.includes("eval(")) {
      report("error", "Security", "Contains 'eval()' (High Security Risk)", t.name);
    }
  });

  return issues;
}

// ==========================================
// 🎨 UI RENDERER
// ==========================================
function renderReport(issues, data) {
  const stats = {
    error: issues.filter(i => i.severity === 'error').length,
    warning: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length
  };

  let html = `
    <div style="font-family:'Segoe UI', sans-serif;">
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:5px; margin-bottom:15px; text-align:center;">
        <div style="background:#fce8e6; padding:8px; border-radius:4px; border:1px solid #fad2cf;">
          <div style="font-size:18px; font-weight:bold; color:#d93025;">${stats.error}</div>
          <div style="font-size:10px; color:#d93025;">ERRORS</div>
        </div>
        <div style="background:#fef7e0; padding:8px; border-radius:4px; border:1px solid #fce8b2;">
          <div style="font-size:18px; font-weight:bold; color:#e37400;">${stats.warning}</div>
          <div style="font-size:10px; color:#e37400;">WARNINGS</div>
        </div>
        <div style="background:#e8f0fe; padding:8px; border-radius:4px; border:1px solid #d2e3fc;">
          <div style="font-size:18px; font-weight:bold; color:#1967d2;">${data.tags.length}</div>
          <div style="font-size:10px; color:#1967d2;">TOTAL TAGS</div>
        </div>
      </div>

      <div style="max-height:300px; overflow-y:auto; border-top:1px solid #eee;">
  `;

  if (issues.length === 0) {
    html += `<div style="padding:20px; text-align:center; color:#188038;">✅ Perfect Audit! No issues found.</div>`;
  }

  const severityOrder = ["error", "warning", "info"];
  issues.sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity));

  issues.forEach(issue => {
    let color = "#5f6368";
    let icon = "ℹ️";
    let bg = "#f8f9fa";
    
    if (issue.severity === "error") { color = "#d93025"; icon = "❌"; bg = "#fce8e6"; }
    else if (issue.severity === "warning") { color = "#e37400"; icon = "⚠️"; bg = "#fef7e0"; }

    html += `
      <div style="background:${bg}; margin-bottom:5px; padding:8px; border-radius:4px; font-size:12px; border-left:3px solid ${color};">
        <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
          <span style="font-weight:bold; color:${color};">${icon} ${issue.category}</span>
          <span style="font-size:10px; opacity:0.7;">${issue.severity.toUpperCase()}</span>
        </div>
        <div style="color:#202124; margin-bottom:2px;">${issue.message}</div>
        ${issue.itemName ? `<div style="font-family:monospace; font-size:11px; background:rgba(0,0,0,0.05); padding:2px 4px; border-radius:3px; display:inline-block;">${issue.itemName}</div>` : ''}
      </div>
    `;
  });

  html += `</div></div>`;
  return html;
}

// ==========================================
// 📥 EXPORT FUNCTIONALITY
// ==========================================
function downloadCSV(issues, accountName) {
  const headers = ["Severity,Category,Issue,Item Name"];
  const rows = issues.map(i => {
    const cleanMsg = `"${i.message.replace(/"/g, '""')}"`;
    const cleanItem = `"${i.itemName.replace(/"/g, '""')}"`;
    return `${i.severity.toUpperCase()},${i.category},${cleanMsg},${cleanItem}`;
  });

  const csvContent = headers.concat(rows).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `GTM_Audit_${accountName}_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================
// ⚡ EXECUTION LOGIC
// ==========================================
let currentIssues = [];

document.getElementById("audit").addEventListener('click', async () => {
  const acc = document.getElementById("accounts");
  const cont = document.getElementById("containers");
  const work = document.getElementById("workspaces");
  const output = document.getElementById("output");

  if (!acc.value || acc.value.includes("Select")) {
    output.textContent = "❌ Please select an account.";
    return;
  }

  output.innerHTML = "<div style='text-align:center; padding:20px;'>🕵️ Analyzing 7 Audit Pillars...</div>";

  try {
    const data = await fetchJSON(`${API}/audit/${acc.value}/${cont.value}/${work.value}`);
    
    const workspaceMeta = {
      totalWorkspaces: work.options.length,
      currentName: work.options[work.selectedIndex].text
    };

    // Run Engine
    currentIssues = runAudit(data, workspaceMeta);
    
    // Render Results
    output.innerHTML = renderReport(currentIssues, data);
    
    // Add Export Button
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "📥 Download CSV Report";
    exportBtn.style.cssText = "width:100%; margin-top:10px; background:#188038; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:bold;";
    
    exportBtn.onclick = () => {
      const accountName = acc.options[acc.selectedIndex].text.replace(/[^a-z0-9]/gi, '_');
      downloadCSV(currentIssues, accountName);
    };

    output.insertBefore(exportBtn, output.firstChild);
    
  } catch (err) {
    output.textContent = "Error: " + err.message;
  }
});

loadAccounts();