# website-audit

A **Claude Code skill** that takes a snapshot of a live website before you rebuild it:
what breaks, what is slow, what is unreadable on a phone, and above all where the site
loses leads.

You give it a URL. It opens up to 10 pages (you choose the limit) in headless Chrome at
desktop width and at 360, 390 and 768 px, runs every check from a script inside the
skill, and writes one markdown report. Claude then confirms what a script cannot judge
by looking at the screenshots, and hands you a report you can turn into the first
sprint of the rebuild. It is read-only: no form is submitted, nothing is logged into,
robots.txt is respected and there is a pause between page loads.

## What you get

→ a score per area: conversion path, mobile layout, bugs, accessibility, performance, SEO

→ findings sorted P0 (blocks leads or breaks the site) to P3 (polish), each with where it
happens (URL, viewport, CSS selector), why it costs leads and a concrete fix

→ a «Fix first» list that reads as the first sprint of the rebuild

→ a before-rebuild snapshot: first-screen CTA on desktop and phone, clicks to contact,
Lighthouse score, LCP, page weight, broken links, accessibility violations, the
third-party scripts the new site has to carry over

→ raw JSON and first-screen screenshots next to the report, so the same command on the
new site gives you the «after» numbers

## What it checks

| Area | How |
|---|---|
| Conversion path | CTA in the first screen on desktop and on a phone, clicks from the homepage to contact, email / phone / booking link / lead form, testimonials, case studies, client logos, proof numbers |
| Mobile layout | sideways scroll, elements past the screen edge, viewport meta, tap targets under 32 px, text under 12 px |
| Bugs | console errors, uncaught exceptions, 4xx/5xx responses, mixed content, broken images, broken internal links, form targets (checked with HEAD, never submitted) |
| Accessibility | axe-core with the WCAG 2.0 / 2.1 A and AA rules |
| Performance | Lighthouse (mobile) on the homepage, browser timing on every page |
| SEO basics | title, meta description, one H1, canonical, Open Graph, noindex, robots.txt, sitemap.xml |

Conversion checks are heuristics. Anything the script is unsure about is marked
«check manually», and the skill tells Claude how to resolve it from the screenshots.

## Install

```bash
npx skills add victor-shulga/website-audit
```

Then in Claude: "audit this site https://example.com", "what's wrong with this website",
"аудит сайту linear.app", "технічний аудит сайту перед редизайном".

Or run the script directly:

```bash
node skills/website-audit/scripts/audit.mjs https://example.com --limit 10
```

The report lands in `./website-audit/<domain>/` (override with `--out` or
`WEBSITE_AUDIT_OUT`).

## Requirements & integrations

| Integration | Used for | Required? | Auth / setup |
|---|---|---|---|
| Claude Code | running the skill and the manual review pass | yes | claude.com/claude-code |
| Node.js 22+ | `scripts/audit.mjs` (no npm packages; uses the built-in WebSocket) | yes | nodejs.org |
| Google Chrome or Chromium | headless rendering over the DevTools protocol | yes | auto-detected; or `npx playwright install chromium`; or set `CHROME_BIN` |
| axe-core | accessibility rules, injected into each page | optional (area skipped without it) | downloaded once from a public npm CDN; offline: `AXE_SOURCE=/path/to/axe.min.js` |
| Lighthouse | mobile performance score for the homepage | optional (browser timing used without it) | fetched with `npx --yes`; needs Node ≥ 22.19 and npm |

No API keys, no accounts.

## Credits

Audit checklists adapted from the `site-audit` plugin by dan323
(https://github.com/dan323/easier-life-skills), MIT License, Copyright (c) 2026 dan323.

Part of the GTM-system methodology by [Victor Shulga](https://victorshulga.com) (Fractional CRO).
Every skill in the stack: [CATALOG.md](https://github.com/victor-shulga/max/blob/main/CATALOG.md).

## License

MIT © Victor Shulga. Adapted portions keep the original MIT notice; both are in `LICENSE`.
