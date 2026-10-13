---
name: website-audit
description: >
  Read-only technical and conversion audit of a live website, made as the
  before-rebuild snapshot of a B2B site. Crawls up to N same-origin pages (default 10)
  in headless Chrome and checks mobile layout at 360/390/768 px, bugs (console errors,
  failed requests, broken links and images, forms without submitting them),
  accessibility (axe-core, WCAG 2.1 A/AA), performance (Lighthouse or browser timing),
  the lead path (CTA in the first screen on desktop and phone, contact within 2 clicks,
  contact info, trust markers) and SEO basics. Writes one markdown report with scores
  per area, findings P0-P3 (what, where, why it costs leads, fix) and a snapshot to
  compare after the rebuild, plus raw JSON. Use when the user says "audit this site",
  "what's wrong with this website", "website audit", "check this URL", "аудит сайту",
  "технічний аудит сайту", "перевір сайт", "що не так із сайтом". NOT a copywriting
  audit (use website-copy-reframe), NOT a design system (use design-system-generator).
---

# website-audit

One command measures the site; you then confirm what a script cannot judge and hand
over a report a founder can act on. The audit is **read-only**: it never submits a
form, never logs in, never clicks anything that changes state, respects robots.txt
and pauses between page loads.

## Inputs

- **URL** (required). Ask for it if the user did not give one.
- **Page limit** (optional, default 10). Use 3–5 for a quick look, 15–25 for a full
  pre-rebuild baseline.
- **Report language** (optional, default = the language the user writes in).

## Requirements

- Node.js 22 or newer (`node --version`). Lighthouse additionally needs Node ≥ 22.19
  and npm (`npx`).
- Google Chrome or Chromium. Auto-detected on macOS, Linux and Windows, including a
  Chromium already downloaded by `npx playwright install chromium`. Otherwise set
  `CHROME_BIN=/path/to/chrome`.
- Network access to the audited site, plus a public npm CDN (axe-core) and the npm
  registry (Lighthouse). If either tool cannot be fetched, that area is marked as
  skipped in the report with the reason; the run does not fail.

## Steps

### 1. Run the audit

`<skill-dir>` is the folder this SKILL.md lives in.

```bash
node <skill-dir>/scripts/audit.mjs https://example.com --limit 10
```

Options: `--limit N` · `--delay MS` (pause between pages, default 1000) ·
`--max-links N` (internal link checks, default 150) · `--no-lighthouse` · `--no-axe` ·
`--max-minutes N` (default 15) · `--out DIR`.

Output goes to `./website-audit/<domain>/` relative to the current folder
(override with `--out` or the `WEBSITE_AUDIT_OUT` env var):

- `website-audit-<domain>-<date>.md`: the report
- `website-audit-<domain>-<date>.json`: raw measurements, findings, scores, snapshot
- `screens/`: first-screen screenshots per page, desktop and 390 px

Progress goes to stderr; the last stdout line is a JSON summary
(`ok`, `report`, `pages`, `seconds`, `overall`, `counts`, `scores`, `skipped`).
Exit code 2 means the audit could not run at all (no Node 22, no Chrome, site
unreachable): show the user the message, it says what to install or check.

A 10-page run takes about 2–4 minutes; Lighthouse adds 30–60 seconds.

### 2. Manual review pass

Follow `<skill-dir>/references/manual-review.md`:

1. Confirm every P0 against its evidence (the script is literal; bot protection or a
   JavaScript form can fake a P0).
2. Resolve each «check manually» item by reading the screenshots in `screens/`.
3. Make sure «Fix first» reads as the first sprint of the rebuild.

Edit the markdown report in place. Do not change the JSON; it is the raw baseline.

### 3. Language

The script writes English. If the user writes in another language, translate the
report's headings, «Why it matters for leads» and «Fix» lines. Keep URLs, selectors,
metric names, HTTP codes and P0 to P3 labels as they are.

### 4. Hand over

Reply with: overall score, P0 / P1 counts, the «Fix first» list, which areas were
skipped and why, and the path to the report. Offer to re-run on the new site later
with the same limit to fill the «after» column of the snapshot.

If the user wants it re-rendered after editing thresholds:
`node <skill-dir>/scripts/report.mjs <path-to-run>.json` rewrites the markdown from
the JSON.

## What each area covers

Details, thresholds and the priority rules are in
`<skill-dir>/references/checks.md`. In short:

| Area | How |
|---|---|
| Mobile layout | each page at 360 / 390 / 768 px: sideways scroll, elements past the edge, viewport meta, tap targets, tiny text |
| Bugs | console errors and exceptions, 4xx/5xx and failed requests, mixed content, broken images, internal links (HEAD/GET), form targets (HEAD only) |
| Accessibility | axe-core injected into each page, WCAG 2.0/2.1 A + AA tags |
| Performance | Lighthouse mobile on the homepage; browser timing (TTFB, LCP, CLS, weight, requests) on every page |
| Conversion path | first-screen CTA on desktop and phone, clicks to contact, email / phone / booking / lead form, testimonials, cases, logos, numbers |
| SEO basics | title, description, one H1, canonical, Open Graph, noindex, robots.txt, sitemap.xml |

## Rules

- Never submit, fill or click forms; never log in; never bypass bot protection or a
  CAPTCHA. If the site serves a challenge page, report that and stop.
- Respect robots.txt disallow rules; keep the default delay unless the user owns the
  site and asks for a faster run.
- Findings marked «check manually» are hypotheses until you look at the screenshot.
- Do not publish the report anywhere on your own; it may describe a client's weak spots.

## Not this skill

- Copy, positioning and messaging critique → `website-copy-reframe`.
- A brand / design system from a site → `design-system-generator`.
- Keyword rankings, backlinks, traffic estimates → an SEO data tool.
