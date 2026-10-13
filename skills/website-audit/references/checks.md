# What the audit checks, and how each finding gets its priority

Everything below is measured by `scripts/audit.mjs` and turned into findings by
`scripts/lib/rules.mjs`. Change thresholds there, not in the report.

## Priority scale

| Priority | Meaning | Typical examples |
|---|---|---|
| P0 | Blocks leads or breaks the site | page 4xx/5xx, form posts to a dead URL, no contact path within 2 clicks, homepage scrolls sideways on phones, no viewport meta, homepage noindex, robots.txt blocks everything, broken link in the navigation |
| P1 | Loses leads on a common path | no CTA in the first screen (desktop or phone), uncaught JS error, broken internal link, unlabeled form fields, insecure resources, LCP over 4 s, Lighthouse under 50, missing title |
| P2 | Friction or lost reach | low contrast and other serious axe rules, small tap targets, missing meta description, no H1, no sitemap, no testimonials / cases, heavy page |
| P3 | Polish | minor axe rules, tiny text, title/description length, missing canonical / Open Graph, layout shift under 0.25 |

Area score = 100 − (30 × P0 + 12 × P1 + 5 × P2 + 1 × P3) for that area, floor 0.
Performance uses the Lighthouse score instead when Lighthouse ran.

## Pages

- Homepage first (after redirects), then candidates from homepage links and sitemap.xml
  (sitemap index: first 5 child sitemaps). Ranking: contact → pricing → services →
  cases/portfolio → about → booking/demo pages, then navigation links, then the rest.
- Same origin only, no query strings, no file downloads. URLs disallowed for `*` in
  robots.txt are skipped and listed in the JSON.
- Pause between page loads: `--delay` (default 1000 ms). Time budget: `--max-minutes`.

## Mobile layout (360 / 390 / 768 px)

Each page is loaded at three widths with touch emulation.

- **Horizontal scroll**: document wider than the viewport by more than 2 px. Phones →
  P0 on the homepage, P1 elsewhere; tablet → P2.
- **Offenders**: outermost visible elements whose box sticks out more than 8 px past
  the edge and is not clipped by an `overflow` ancestor (off-canvas menus and
  screen-reader-only elements are ignored). The first one is the selector to fix.
- **Viewport meta** missing → P0.
- **Tap targets** under 32 × 32 px at 390 px (inline links inside text are exempt) → P2.
- **Tiny text** under 12 px at 390 px → P3.

## Bugs

- Console `error` messages and uncaught exceptions during load.
- Responses with status ≥ 400 for page resources; network failures (aborted and
  ad-blocker style failures ignored).
- Mixed content: `http://` requests from an `https://` page.
- Broken images: `<img>` that finished loading with zero natural width, plus empty /
  `undefined` / template-token `src`.
- Raw template output in visible text: `{{ }}`, `{% %}`, `[object Object]`.
- Internal links: every same-origin link found on the audited pages, HEAD first, GET
  when HEAD is refused, capped by `--max-links` (default 150). A broken link that sits
  in `<header>` or `<nav>` is P0.
- Forms: presence, labels, a submit control, and the `action` URL checked with HEAD.
  **No form is ever filled or submitted.** Forms handled only by JavaScript show up as
  «check manually».

## Accessibility

axe-core (pinned version, downloaded once from a public npm CDN into
`<out>/.cache/`) is injected into each page and run with the `wcag2a`, `wcag2aa`,
`wcag21a`, `wcag21aa` tags. Impact mapping: critical → P1, serious → P2,
moderate / minor → P3. Same rule on several pages = one finding with all pages listed.
Offline: set `AXE_SOURCE=/path/to/axe.min.js`. If axe cannot load, the area is marked
skipped with the reason.

## Performance

- Lighthouse (pinned, via `npx --yes`) on the homepage, mobile preset with throttling:
  score, LCP, CLS, TBT, top opportunities. Needs Node ≥ 22.19 and npm.
- Every page also gets browser timing at desktop width without throttling: TTFB,
  FCP, LCP, CLS, transferred bytes, request count, render-blocking `<head>` scripts,
  images without dimensions. Without Lighthouse these numbers drive the area score,
  and the report says so.

Thresholds: LCP > 2.5 s P2, > 4 s P1 · CLS > 0.1 P3, > 0.25 P2 · TBT > 200 ms P3,
> 600 ms P2 · TTFB > 1.8 s P2 · weight > 3 MB P2, > 5 MB P1 · > 120 requests P3.

## Conversion path (the reason this audit exists)

All heuristics; anything uncertain is tagged «check manually».

- **CTA in the first screen**: visible link or button whose text or target looks like
  a next step (contact, book, call, demo, quote, consult, start, plus Ukrainian and
  Russian stems), or that points to `mailto:` / `tel:` / a booking or contact URL.
  Measured at 1440 × 900 and at 390 × 844 (where collapsed burger menus hide header
  links). A CTA that is only an unstyled text link → P2.
- **Contact path**: fewest clicks from the homepage to a contact page, booking link,
  `mailto:`/`tel:`, or a page with a lead form (email field, not search, not login).
  Only links seen on audited pages count. Not found → P0; 2 clicks → P3.
- **Contact info**: email or phone anywhere on audited pages; booking link; lead form.
- **Trust markers**: testimonials (words, `<blockquote>`, testimonial/review classes),
  case studies (links or words), client logo strips (logo-like images outside the
  header), proof numbers (years, projects, %, «N+»), ratings / awards.

## SEO basics

Title (present, 15–65 chars, unique), meta description (present, 50–165 chars,
unique), exactly one visible H1, canonical (present, same domain), Open Graph
title / description / image, robots meta and `X-Robots-Tag` noindex, robots.txt
present and not blocking everything, sitemap.xml present.

## What it does not do

No login, no form submission, no clicks that change state, no external link checks,
no keyword research or backlink data, no copy critique, no design review. Those
belong to other tools; see the SKILL.md «not this skill» list.
