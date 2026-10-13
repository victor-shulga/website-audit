# Manual review pass (10 minutes, before the report leaves your hands)

The script is fast and literal. A human-quality report needs one short pass over
what it could not judge. Do it in this order and edit the markdown report in place.

## 1. Confirm every P0

For each P0, open the evidence yourself before keeping it:

- **Page error / load error**: open the URL with a normal fetch or browser. Temporary
  5xx or bot protection (a challenge page) is a note, not a P0.
- **Dead form target**: HEAD returned 404/410/5xx. Look at the form: if it is posted by
  JavaScript to another endpoint, downgrade to «check manually».
- **No contact path**: look at `screens/home-desktop.jpg` and `screens/home-390.jpg`.
  If a chat widget, a contact block or a booking embed is visible, the heuristic missed
  it: remove the finding and note what the contact route is.
- **Horizontal scroll on the homepage**: the selector in «Where» is the element to fix.
  Keep it; it is measured, not guessed.

## 2. Resolve «check manually» items

Read the first-screen screenshots (`screens/*-desktop.jpg`, `screens/*-390.jpg`) with
the image viewer and decide each item:

| Item | Keep it when | Drop it when |
|---|---|---|
| CTA is a plain link | the next step is hard to spot in the screenshot | a clear button is there but uses words the detector does not know |
| No testimonials / cases / logos / numbers | you also cannot see them on the audited pages | they exist as images or on a page outside the limit (say where) |
| No booking link / lead form | no calendar or form anywhere | the form lives in an iframe (third-party form or booking widget) |
| noindex on a page | the page is a service, case or landing page | it is a thank-you, legal or test page |
| Form without submit | the form cannot be sent | it is a multi-step or JS form with its own button |

Write the decision into the finding («Checked: …») or delete it. Do not leave
«check manually» in a report that goes to a client unless you state why you could not
check it.

## 3. Read the report as the buyer of the rebuild

The audit exists to answer «what costs us leads today, and what must the new site keep
or fix». Before sending:

- The **Fix first** list should read as the first sprint of the rebuild. If a P2 matters
  more for this business than a P1 (e.g. no case studies for a services company), say so
  in one line under the list.
- The **Before-rebuild snapshot** is the baseline. Keep the run folder (JSON +
  screenshots); the same command on the new site gives the «after» numbers.
- Third-party script hosts in the snapshot are the tracking, chat and widget code the
  new site must carry over (or deliberately drop).

## 4. Language

The script writes English. If the user writes in another language, translate the
headings, «Why it matters» and «Fix» lines into that language. Keep URLs, selectors,
metric names (LCP, CLS, TTFB), HTTP codes and the P0 to P3 labels unchanged so the
before/after comparison still lines up.
