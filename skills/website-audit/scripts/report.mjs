#!/usr/bin/env node
// Renders the markdown report from the raw JSON written by audit.mjs.
// Can be re-run on its own:  node <skill-dir>/scripts/report.mjs <run>.json
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { analyze, AREAS } from "./lib/rules.mjs";

const PTITLE = {
  P0: "P0 · blocks leads or breaks the site",
  P1: "P1 · loses leads on a common path",
  P2: "P2 · friction or lost reach",
  P3: "P3 · polish",
};

const esc = s => String(s ?? "").replace(/\|/g, "·").replace(/\n/g, " ");
const rel = (u, origin) => { try { const x = new URL(u); return x.origin === origin ? (x.pathname + x.search) || "/" : u; } catch { return u; } };
const yn = v => (v ? "yes" : "no");

export function render(raw) {
  const a = analyze(raw);
  const m = raw.meta;
  const origin = m.origin;
  const L = [];
  L.push(`# Website audit: ${m.domain}`);
  L.push("");
  L.push(`${m.startedAt.slice(0, 16).replace("T", " ")} UTC · ${raw.pages.length} page(s) audited (limit ${m.limit}) · run time ${m.seconds}s · read-only`);
  L.push("");
  L.push("## Summary");
  L.push("");
  L.push(`**Overall: ${a.overall ?? "n/a"}/100** · P0 **${a.counts.P0}** · P1 **${a.counts.P1}** · P2 ${a.counts.P2} · P3 ${a.counts.P3}`);
  L.push("");
  L.push("| Area | Score | P0 | P1 | P2 | P3 | Note |");
  L.push("|---|---|---|---|---|---|---|");
  for (const [k, name] of Object.entries(AREAS)) {
    const s = a.scores[k];
    const note = s.skipped ? `skipped: ${s.skipped}` : s.note ? s.note : s.source ? `source: ${s.source}` : "";
    L.push(`| ${name} | ${s.score ?? "-"} | ${s.P0 ?? "-"} | ${s.P1 ?? "-"} | ${s.P2 ?? "-"} | ${s.P3 ?? "-"} | ${esc(note)} |`);
  }
  L.push("");
  L.push("Score = 100 minus 30 per P0, 12 per P1, 5 per P2, 1 per P3 finding in that area (floor 0). Performance uses the Lighthouse score when Lighthouse ran.");
  const skipped = Object.entries(raw.skipped || {});
  if (skipped.length) {
    L.push("");
    for (const [k, why] of skipped) L.push(`> **${AREAS[k] || k}: ${k === "perf" ? "Lighthouse skipped, browser timing used instead" : "skipped"}.** ${why}`);
  }
  const top = a.findings.filter(f => f.priority !== "P3").slice(0, 5);
  if (top.length) {
    L.push("");
    L.push("### Fix first");
    L.push("");
    top.forEach((f, i) => L.push(`${i + 1}. **${f.title}** (${f.priority}, ${f.pages} page${f.pages === 1 ? "" : "s"}): ${f.fix}`));
  }

  // snapshot
  const s = a.snapshot;
  L.push("");
  L.push("## Before-rebuild snapshot");
  L.push("");
  L.push("Re-run the audit on the new site with the same page limit and compare these lines.");
  L.push("");
  L.push("| Metric | Now |");
  L.push("|---|---|");
  const rows = [
    ["Audit date", s.date],
    ["Pages audited / URLs in sitemap", `${s.pagesAudited} / ${s.urlsInSitemap || "no sitemap"}`],
    ["Overall score", a.overall ?? "n/a"],
    ...Object.entries(AREAS).map(([k, n]) => [`Score: ${n}`, a.scores[k].score ?? "skipped"]),
    ["P0 / P1 / P2 / P3", `${a.counts.P0} / ${a.counts.P1} / ${a.counts.P2} / ${a.counts.P3}`],
    ["Homepage title", s.homeTitle ? `«${s.homeTitle}»` : "missing"],
    ["Homepage H1", s.homeH1 ? `«${s.homeH1}»` : "missing"],
    ["First-screen CTA, desktop", s.homeCtaDesktop],
    ["First-screen CTA, phone (390px)", s.homeCtaMobile],
    ["Clicks from homepage to contact", s.contactClicks ?? "not found"],
    ["Contact route", s.contactRoute || "-"],
    ["Email / phone / booking link / lead form", `${yn(s.email)} / ${yn(s.phone)} / ${yn(s.booking)} / ${yn(s.leadForm)}`],
    ["Lighthouse performance (mobile)", s.lighthouseMobile ?? "not run"],
    [`LCP (${s.lcpSource})`, s.lcpMs != null ? `${(s.lcpMs / 1000).toFixed(1)} s` : "n/a"],
    ["Homepage weight / requests", s.homeWeightKB != null ? `${s.homeWeightKB} KB / ${s.homeRequests}` : "n/a"],
    ["Pages with sideways scroll on phones", s.pagesWithMobileScroll],
    ["Accessibility violations (elements)", s.axeViolations],
    ["Console errors + JS exceptions", s.consoleErrors],
    ["Internal links checked / broken", `${s.internalLinksChecked} / ${s.brokenInternalLinks}`],
    ["Visible forms", s.forms],
    ["Third-party script hosts", s.thirdPartyScriptHosts.length ? s.thirdPartyScriptHosts.join(", ") : "none"],
  ];
  for (const [k, v] of rows) L.push(`| ${esc(k)} | ${esc(v)} |`);

  // findings
  L.push("");
  L.push("## Findings");
  for (const p of ["P0", "P1", "P2", "P3"]) {
    const fs = a.findings.filter(f => f.priority === p);
    L.push("");
    L.push(`### ${PTITLE[p]} (${fs.length})`);
    if (!fs.length) { L.push(""); L.push("None found."); continue; }
    for (const f of fs) {
      L.push("");
      L.push(`#### ${f.n}. ${f.title}${f.manual ? " · check manually" : ""}`);
      L.push(`*${AREAS[f.area]}*`);
      L.push("");
      const where = f.where.slice(0, 5).map(w => {
        const bits = [w.viewport, w.selector ? `\`${w.selector}\`` : null].filter(Boolean).join(", ");
        return `${rel(w.url, origin)}${bits ? ` (${bits})` : ""}`;
      });
      const more = f.where.length > 5 ? ` +${f.where.length - 5} more` : "";
      if (where.length) L.push(`- **Where:** ${[...new Set(where)].join("; ")}${more}`);
      if (f.evidence.length) L.push(`- **Evidence:** ${f.evidence.map(e => esc(e)).join("; ")}`);
      L.push(`- **Why it matters for leads:** ${f.why}`);
      L.push(`- **Fix:** ${f.fix}`);
    }
  }

  // pages
  L.push("");
  L.push("## Pages audited");
  L.push("");
  L.push("| # | URL | HTTP | Title |");
  L.push("|---|---|---|---|");
  raw.pages.forEach((p, i) => L.push(`| ${i + 1} | ${esc(p.url)} | ${p.status ?? (p.error ? "error" : "-")} | ${esc(p.desktop?.title?.slice(0, 70) || p.error || "")} |`));

  // method
  L.push("");
  L.push("## Method and limits");
  L.push("");
  L.push(`- Headless Chrome (${esc(m.browser)}) at 1440px desktop plus 360 / 390 / 768px; screenshots in \`screens/\`.`);
  L.push(`- Pages chosen from ${m.pageSource}. robots.txt respected${raw.site?.skippedByRobots?.length ? ` (${raw.site.skippedByRobots.length} URL(s) skipped as disallowed)` : ""}; ${m.delayMs} ms pause between page loads.`);
  L.push(`- Read-only: no form was submitted, nothing was clicked, no login. Form targets were checked with a HEAD request only.`);
  L.push(`- Internal links checked: ${(raw.linkCheck || []).length}${m.linkCap && (raw.linkCheck || []).length >= m.linkCap ? ` (capped at ${m.linkCap})` : ""}. External links are not checked.`);
  L.push(`- Accessibility: ${raw.skipped?.a11y ? "skipped" : `axe-core ${m.axeVersion}, WCAG 2.0/2.1 A + AA rules`}. Automated rules catch roughly a third of WCAG issues; keyboard and screen-reader passes still need a human.`);
  L.push(`- Performance: ${raw.lighthouse?.score != null ? `Lighthouse ${raw.lighthouse.version || ""} on the homepage (mobile, throttled)` : "browser timing on desktop without throttling"}; other pages use browser timing.`);
  L.push(`- Conversion checks are heuristics on text and links. Items marked «check manually» need a human look at the screenshots before they go to the client.`);
  if (m.pagesLimited) L.push(`- The page limit was reached; contact and trust checks only see the audited pages.`);
  if (m.notes?.length) for (const n of m.notes) L.push(`- ${esc(n)}`);
  L.push("");
  return { md: L.join("\n"), analysis: a };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) { console.error("usage: node report.mjs <run>.json"); process.exit(2); }
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const { md } = render(raw);
  const out = file.replace(/\.json$/, ".md");
  writeFileSync(out, md);
  console.log(out);
}
