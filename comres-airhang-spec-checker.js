/* =========================================================================
   ADR AIRHANG SPEC CHECKER
   -------------------------------------------------------------------------
   What this does
   ---------------
   Run this against an ADR Airhang report (the .htm file Quasar/CWI
   generates) that is already open as the active tab in Edge. It scans
   every parameter table in the report (Compensated Drive Levels, Phase,
   Atten, Amplitude... under High Gain / Low Gain x 500 kHz / 2 MHz), looks
   up each value against the SPEC table below, and highlights every cell:

       green  = in spec
       red    = OUT OF SPEC
       gray   = value is "na" / blank (skipped)
       yellow = no spec entry defined for that parameter yet

   It also drops a floating panel (top-right) with a pass/fail summary,
   a "jump to next failure" button, and a spec editor so you can add/adjust
   limits live without re-editing this file every time, then export the
   result back out as JSON to paste in here permanently.

   How to use it
   --------------
   1. Open the ADR Airhang .htm report in Edge.
   2. Fill in SPEC below with real limits (see the shapes explained above
      the SPEC object). You can leave parameters out — they'll just show
      up yellow ("no spec") until you add them.
   3. Turn this file into a bookmarklet (see build-bookmarklet.py in the
      same folder, or ask Claude to regenerate bookmarklet.txt after you
      edit SPEC) and click the bookmarklet while the report tab is active.
      Or: paste this whole file into DevTools Console (F12 > Console) on
      the report tab and hit Enter — works exactly the same, no bookmarklet
      needed.
   4. Re-run any time (e.g. after editing SPEC in the live panel) by
      clicking the bookmarklet again — it re-scans from scratch.

   Editing SPEC
   ------------
   Two supported shapes per parameter/spacing entry:
     { min: 4800, max: 6000 }                  -> hard range
     { expected: 5450, tol: 200 }               -> center +/- absolute tol
     { expected: 5450, tolPct: 5 }              -> center +/- % tol
     { max: 0.05 }                              -> ceiling only (e.g. std dev)
     { min: 20 }                                -> floor only

   Keys, from outer to inner:
     SPEC[section][parameterName][spacing]
     SPEC[section][parameterName]["*"]          -> applies to all spacings
                                                    under that parameter
     SPEC["*"][parameterName][...]              -> applies to that
                                                    parameter name in ANY
                                                    section (checked only if
                                                    the section-specific
                                                    lookup found nothing)

   section is one of exactly these four strings (matches the report's own
   section headers):
     "High Gain 500 kHz", "High Gain 2 MHz",
     "Low Gain 500 kHz",  "Low Gain 2 MHz"

   parameterName must match the row label text in the report exactly
   (e.g. "Upper Tx Voltage (mV)", "Compensated Atten", "Phase Std Dev").
   Run once with an empty-ish SPEC and open the "Edit Spec" panel in the
   report — it lists every parameter name + spacing actually found in
   THIS report, pre-formatted as a JSON skeleton you can copy from.
   ========================================================================= */

(function () {
  "use strict";

  // -----------------------------------------------------------------------
  // 1. SPEC TABLE — fill this in. Empty/partial is fine to start.
  // -----------------------------------------------------------------------
  const SPEC = {
    // Example (delete or edit once you have real numbers):
    // "High Gain 500 kHz": {
    //   "Upper Tx Voltage (mV)": { "48''": { min: 5000, max: 6000 } },
    //   "Compensated Atten Std Dev": { "*": { max: 0.05 } }
    // },
    // "*": {
    //   "Compensated Atten Std Dev": { "*": { max: 0.05 } }
    // }
  };

  // -----------------------------------------------------------------------
  // 2. AUTO-RULES — the report itself sometimes prints an "Expected X" row
  //    right next to the measured row (e.g. "Compensated Atten" next to
  //    "Expected Atten"). These rules use that as a live, self-supplied
  //    spec when SPEC above doesn't have an explicit entry, using a
  //    tolerance you set here. Adjust or add rows as needed; set the
  //    tolerance to null to disable a rule.
  // -----------------------------------------------------------------------
  const AUTO_EXPECTED_RULES = [
    { valueParam: "Compensated Atten", expectedParam: "Expected Atten", tolAbs: 0.5 },
    { valueParam: "Atten (dB)",        expectedParam: "Expected Atten", tolAbs: 0.5 },
  ];

  // Section container ids as they appear in the report's own DOM.
  const SECTION_IDS = {
    "High Gain 500 kHz": "High Gain500 kHzTable",
    "High Gain 2 MHz":   "High Gain2 MHzTable",
    "Low Gain 500 kHz":  "Low Gain500 kHzTable",
    "Low Gain 2 MHz":    "Low Gain2 MHzTable",
  };

  // -----------------------------------------------------------------------
  // Below this line is scanning/highlighting engine — shouldn't need edits.
  // -----------------------------------------------------------------------

  function lookupSpec(section, param, spacing) {
    const bySection = SPEC[section] && SPEC[section][param];
    if (bySection) {
      if (bySection[spacing]) return bySection[spacing];
      if (bySection["*"]) return bySection["*"];
    }
    const wild = SPEC["*"] && SPEC["*"][param];
    if (wild) {
      if (wild[spacing]) return wild[spacing];
      if (wild["*"]) return wild["*"];
    }
    return null;
  }

  function evalSpec(spec, value) {
    if (!spec) return null; // no spec defined
    let lo = -Infinity, hi = Infinity;
    if (typeof spec.min === "number") lo = spec.min;
    if (typeof spec.max === "number") hi = spec.max;
    if (typeof spec.expected === "number") {
      let tol = 0;
      if (typeof spec.tol === "number") tol = spec.tol;
      if (typeof spec.tolPct === "number") tol = Math.abs(spec.expected) * spec.tolPct / 100;
      lo = spec.expected - tol;
      hi = spec.expected + tol;
    }
    const pass = value >= lo && value <= hi;
    return { pass, lo, hi };
  }

  function findAutoRule(param) {
    return AUTO_EXPECTED_RULES.find(r => r.valueParam === param && r.tolAbs != null);
  }

  function styleCell(cell, status, tooltip) {
    cell.setAttribute("data-adrqc", status);
    cell.title = tooltip || "";
    const styles = {
      pass:    { bg: "#d7f5d7", fg: "#0a5c0a", border: "1px solid #4caf50" },
      fail:    { bg: "#ffd6d6", fg: "#8a0000", border: "1px solid #e53935" },
      nospec:  { bg: "#fff6cc", fg: "#6b5900", border: "1px solid #e0c200" },
      na:      { bg: "#f0f0f0", fg: "#999999", border: "1px solid #dddddd" },
    };
    const s = styles[status];
    if (!s) return;
    cell.style.backgroundColor = s.bg;
    cell.style.color = s.fg;
    cell.style.border = s.border;
    cell.style.fontWeight = status === "fail" ? "bold" : cell.style.fontWeight;
  }

  function scanSection(sectionName, containerId, results) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const tables = container.querySelectorAll("table");
    tables.forEach(table => {
      const rows = Array.from(table.rows || table.querySelectorAll("tr"));
      if (!rows.length) return;
      const headerCells = Array.from(rows[0].cells || []);
      if (!headerCells.length) return;
      const headerLabel = headerCells[0].textContent.trim();
      if (headerLabel !== "Spacing") return; // not a data table
      const spacings = headerCells.slice(1).map(td => td.textContent.trim());

      // Build a quick lookup of value cells by param name, for AUTO rules
      // that need to read a sibling "Expected X" row.
      const rowByParam = {};
      rows.slice(1).forEach(r => {
        const cells = Array.from(r.cells || []);
        if (!cells.length) return;
        const paramName = cells[0].textContent.trim();
        if (paramName) rowByParam[paramName] = cells;
      });

      rows.slice(1).forEach(r => {
        const cells = Array.from(r.cells || []);
        if (!cells.length) return;
        const paramName = cells[0].textContent.trim();
        if (!paramName) return;

        for (let i = 1; i < cells.length; i++) {
          const cell = cells[i];
          const spacing = spacings[i - 1] || ("col" + i);
          const raw = cell.textContent.trim();
          if (raw === "" || raw.toLowerCase() === "na") {
            styleCell(cell, "na", "No data (na)");
            continue;
          }
          const value = parseFloat(raw);
          if (Number.isNaN(value)) {
            continue; // non-numeric, leave alone
          }

          let spec = lookupSpec(sectionName, paramName, spacing);
          let specSource = "manual";

          if (!spec) {
            const rule = findAutoRule(paramName);
            if (rule) {
              const expCells = rowByParam[rule.expectedParam];
              if (expCells && expCells[i]) {
                const expRaw = expCells[i].textContent.trim();
                const expVal = parseFloat(expRaw);
                if (!Number.isNaN(expVal)) {
                  spec = { expected: expVal, tol: rule.tolAbs };
                  specSource = "auto (" + rule.expectedParam + ")";
                }
              }
            }
          }

          const evaluated = evalSpec(spec, value);
          const record = {
            section: sectionName, param: paramName, spacing, value,
            spec, specSource, status: null,
          };

          if (!evaluated) {
            record.status = "nospec";
            styleCell(cell, "nospec", `${paramName} @ ${spacing}\nValue: ${value}\nNo spec defined`);
          } else {
            record.status = evaluated.pass ? "pass" : "fail";
            const rangeTxt = `${evaluated.lo === -Infinity ? "-inf" : evaluated.lo.toFixed(4)} to ${evaluated.hi === Infinity ? "+inf" : evaluated.hi.toFixed(4)}`;
            styleCell(cell, record.status,
              `${paramName} @ ${spacing}\nValue: ${value}\nSpec (${specSource}): ${rangeTxt}\n${evaluated.pass ? "PASS" : "FAIL"}`);
          }
          record.cell = cell;
          results.push(record);
        }
      });
    });
  }

  function runScan() {
    document.querySelectorAll('[data-adrqc]').forEach(el => {
      el.removeAttribute('data-adrqc');
      el.style.backgroundColor = "";
      el.style.color = "";
      el.style.border = "";
      el.title = "";
    });
    const results = [];
    Object.entries(SECTION_IDS).forEach(([name, id]) => scanSection(name, id, results));
    return results;
  }

  function buildPanel(results) {
    const old = document.getElementById("adrqc-panel");
    if (old) old.remove();

    const pass = results.filter(r => r.status === "pass").length;
    const fail = results.filter(r => r.status === "fail").length;
    const nospec = results.filter(r => r.status === "nospec").length;
    const naCount = results.filter(r => r.status === "na").length;

    const panel = document.createElement("div");
    panel.id = "adrqc-panel";
    panel.style.cssText = `
      position: fixed; top: 12px; right: 12px; width: 300px; max-height: 85vh;
      overflow-y: auto; background: #ffffff; border: 2px solid #333;
      border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      font-family: Tahoma, Arial, sans-serif; font-size: 12px; z-index: 999999;
      padding: 10px;
    `;

    const failList = results.filter(r => r.status === "fail")
      .map((r, i) => `<li style="margin-bottom:4px;"><a href="#" data-idx="${i}" class="adrqc-jump" style="color:#8a0000; font-weight:bold;">${r.section} / ${r.param} @ ${r.spacing}</a> = ${r.value}</li>`)
      .join("");

    panel.innerHTML = `
      <div style="font-weight:bold; font-size:14px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
        <span>ADR Airhang QC</span>
        <button id="adrqc-close" style="cursor:pointer; border:none; background:none; font-size:16px; line-height:1;">&times;</button>
      </div>
      <div style="margin-bottom:8px;">
        <span style="color:#0a5c0a; font-weight:bold;">${pass} pass</span> &nbsp;
        <span style="color:#8a0000; font-weight:bold;">${fail} fail</span> &nbsp;
        <span style="color:#6b5900; font-weight:bold;">${nospec} no-spec</span> &nbsp;
        <span style="color:#999; font-weight:bold;">${naCount} na</span>
      </div>
      <div style="margin-bottom:8px; display:flex; gap:6px; flex-wrap:wrap;">
        <button id="adrqc-rescan" style="cursor:pointer;">Rescan</button>
        <button id="adrqc-editspec" style="cursor:pointer;">Edit Spec / Export</button>
      </div>
      ${fail ? `<div style="font-weight:bold; color:#8a0000; margin-bottom:4px;">Failures:</div>
      <ul style="padding-left:16px; margin:0 0 8px 0;">${failList}</ul>` : `<div style="color:#0a5c0a;">No failures against current spec.</div>`}
      <div id="adrqc-editor" style="display:none; margin-top:8px; border-top:1px solid #ccc; padding-top:8px;"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById("adrqc-close").onclick = () => panel.remove();
    document.getElementById("adrqc-rescan").onclick = () => {
      const r = runScan();
      buildPanel(r);
    };
    panel.querySelectorAll(".adrqc-jump").forEach(a => {
      a.onclick = (e) => {
        e.preventDefault();
        const idx = parseInt(a.getAttribute("data-idx"), 10);
        const failures = results.filter(r => r.status === "fail");
        const rec = failures[idx];
        if (rec && rec.cell) {
          rec.cell.scrollIntoView({ behavior: "smooth", block: "center" });
          rec.cell.style.outline = "3px solid #ff5722";
          setTimeout(() => { rec.cell.style.outline = ""; }, 1500);
        }
      };
    });

    document.getElementById("adrqc-editspec").onclick = () => {
      const ed = document.getElementById("adrqc-editor");
      if (ed.style.display === "none") {
        ed.style.display = "block";
        buildEditor(ed, results);
      } else {
        ed.style.display = "none";
      }
    };
  }

  function buildEditor(container, results) {
    // Build a skeleton of every distinct section/param/spacing found,
    // pre-filled with existing SPEC values where present, so it's easy
    // to see exactly what to add.
    const seen = {};
    results.forEach(r => {
      seen[r.section] = seen[r.section] || {};
      seen[r.section][r.param] = seen[r.section][r.param] || {};
      seen[r.section][r.param][r.spacing] = true;
    });
    const skeleton = {};
    Object.entries(seen).forEach(([section, params]) => {
      skeleton[section] = {};
      Object.entries(params).forEach(([param, spacings]) => {
        const existing = (SPEC[section] && SPEC[section][param]) || {};
        skeleton[section][param] = {};
        Object.keys(spacings).forEach(sp => {
          skeleton[section][param][sp] = existing[sp] || existing["*"] || { min: null, max: null };
        });
      });
    });

    container.innerHTML = `
      <div style="margin-bottom:6px;">Paste-editable spec (found-in-report skeleton, merged with current SPEC). Edit numbers, click Apply to test live, or Copy/Download to save permanently into the SPEC constant in the source file.</div>
      <textarea id="adrqc-spec-text" style="width:100%; height:220px; font-family:monospace; font-size:11px;">${JSON.stringify(skeleton, null, 2)}</textarea>
      <div style="margin-top:6px; display:flex; gap:6px; flex-wrap:wrap;">
        <button id="adrqc-apply">Apply (this session)</button>
        <button id="adrqc-copy">Copy JSON</button>
        <button id="adrqc-download">Download spec.json</button>
      </div>
      <div id="adrqc-editor-msg" style="margin-top:4px; color:#555;"></div>
    `;

    document.getElementById("adrqc-apply").onclick = () => {
      const msg = document.getElementById("adrqc-editor-msg");
      try {
        const parsed = JSON.parse(document.getElementById("adrqc-spec-text").value);
        Object.assign(SPEC, parsed);
        msg.textContent = "Applied. Rescanning...";
        const r = runScan();
        buildPanel(r);
      } catch (e) {
        msg.textContent = "JSON error: " + e.message;
        msg.style.color = "#8a0000";
      }
    };
    document.getElementById("adrqc-copy").onclick = () => {
      const text = document.getElementById("adrqc-spec-text").value;
      navigator.clipboard.writeText(text).then(() => {
        document.getElementById("adrqc-editor-msg").textContent = "Copied to clipboard.";
      }).catch(() => {
        document.getElementById("adrqc-editor-msg").textContent = "Copy failed — select text manually.";
      });
    };
    document.getElementById("adrqc-download").onclick = () => {
      const text = document.getElementById("adrqc-spec-text").value;
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "adr-airhang-spec.json";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    };
  }

  // -----------------------------------------------------------------------
  // Entry point
  // -----------------------------------------------------------------------
  const results = runScan();
  buildPanel(results);
  console.log(`ADR Airhang QC: scanned ${results.length} values — ` +
    `${results.filter(r=>r.status==="pass").length} pass, ` +
    `${results.filter(r=>r.status==="fail").length} fail, ` +
    `${results.filter(r=>r.status==="nospec").length} no-spec, ` +
    `${results.filter(r=>r.status==="na").length} na.`);
})();
