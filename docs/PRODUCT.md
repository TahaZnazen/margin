# Product

> Status: v1 · 2026-10-26 · Codename "Margin" (placeholder until naming is decided)

## One-liner

**Read it once. Remember it.** The PDF reader that turns what you highlight into what you know.

## Problem

People who learn from PDFs (students, exam takers, professionals) forget most of what they read:

- Highlights pile up and are never seen again.
- Notes live in another app, cut off from the page they came from.
- Finding "that passage" again takes minutes.
- AI tools (ChatPDF, NotebookLM) answer questions, but they don't build memory, and they aren't good places to read.

## Who it's for

| Priority | Segment | Why them |
|---|---|---|
| **Beachhead** | Students preparing high-stakes, memorization-heavy exams: medicine, pharmacy, law, professional certifications | Huge PDF course packs, a daily study habit, many already use Anki, willing to pay, strong word of mouth inside cohorts |
| Next | Grad students and researchers | Papers, citations, Zotero users |
| Later | Professionals reading technical books and standards | Team plans |

## Competitive position

| Alternative | Strength | Gap we exploit |
|---|---|---|
| NotebookLM | Free, grounded Q&A over sources | Not a reader; no highlight workflow; no review or memory |
| Readwise Reader | Highlights, daily resurfacing, exports | General reading app where PDF study is secondary; no passage-to-card loop |
| RemNote | PDF annotation into flashcards | Note-taking first with a steep learning curve; the reading experience is secondary |
| LiquidText / MarginNote | Deep annotation | iPad-centric, complex, weak AI, weak web |
| ChatPDF and clones | Chat | No reading experience; nothing persists |
| Anki | Best-in-class spaced repetition | Making cards from PDFs is manual and slow; cards lose their context |

**Our wedge:** one fluid loop *inside the reader*: **Highlight → Understand → Card → Review → back to the exact passage**. It feels instant (local-first), works offline, and the AI only answers from the page.

## The learning loop (product spine)

```
 READ ──► CAPTURE ──► UNDERSTAND ──► RETAIN ──► REVIEW
  ▲                                                │
  └──────── context restore: one click back ───────┘
            to the exact passage in the PDF
```

Every feature belongs to one stage of this loop. A feature that serves no stage doesn't ship.

## Semantic highlight colors (the multiplier)

Colors carry meaning, and meaning drives automation. Defaults, user-configurable:

| Color | Meaning | Downstream effect |
|---|---|---|
| Yellow | Key idea | Feeds the chapter "key ideas" summary |
| Green | Definition | Glossary per book; one-key card |
| Blue | Example / evidence | Grouped under its key idea in the notebook |
| Purple | Memorize | Suggests a flashcard automatically |
| Red | Confusing | Offers "Explain this" and joins the "to clarify" list |

## Feature map

| Stage | Phase 1 — MVP | Phase 2 | Phase 3 | Later |
|---|---|---|---|---|
| **Read** | Upload (drag-drop, resumable, up to 300 MB); library with covers and progress; smooth reader with zoom, outline, thumbnails and find; light, sepia and dark themes; resume at exact position; offline books; keyboard navigation; ⌘K command palette | Library-wide search (titles, full text, highlights, semantic) | — | Reflow mode for phones; read-aloud with sentence follow; split view of two PDFs; EPUB |
| **Capture** | 5 semantic colors; area/figure snapshot; comment on a highlight; bookmarks; tags; annotations panel (filter, jump); per-book notebook with linked quote blocks; **import existing highlights from the PDF**; export to Markdown and annotated PDF | — | — | Stylus ink; Notion, Obsidian and Readwise sync |
| **Understand** | — | Explain, define, simplify or translate a selection, saved to the highlight in one click; "Ask the book" chat with citations that jump to and flash the source; chapter summary and key ideas on demand | — | Concept maps across books |
| **Retain** | — | — | One-key card from a highlight (AI drafts Q/A and cloze cards, you accept); image occlusion from area snapshots (diagrams, anatomy); FSRS daily review with "show in book"; "quiz me on this chapter"; Anki export | Shared decks for study groups |
| **Track** | Reading progress | — | Streaks, reading time, chapter coverage, mastery per chapter (from FSRS retrievability) | Exam-date planner |

## UX principles

1. **It should feel instant.** Every interaction responds in under 100 ms. Reader chrome fades while reading.
2. **One popover for everything.** Selecting text opens the color dots, Note, Explain, Card, and Copy with citation. Every action has a single-key shortcut (1–5 colors, `N` note, `E` explain, `C` card).
3. **Context restore everywhere.** Any highlight, note, card or AI citation is one click from its exact spot in the PDF, which flashes on arrival.
4. **Progressive disclosure.** On day 1 the user sees a beautiful reader. AI and review are discovered through the popover and gentle nudges (e.g. "You marked 12 purple highlights. Turn them into cards?").
5. **Respect the page.** We never re-typeset the author's PDF by default; fidelity comes first.

## Metrics

- **North star:** Weekly Active Learners: users who, in a week, read ≥ 15 minutes **and** (create ≥ 5 annotations **or** complete a review session).
- **Activation:** uploads a PDF and makes ≥ 3 highlights in the first session. Beta target: ≥ 40%.
- **Retention:** week-4 retention of activated users. Beta target: ≥ 30%.
- **Learning signals:** cards reviewed per user per week, % of highlights that become cards, citation click-through.

The targets are starting hypotheses. Revisit them after 4 weeks of beta data.

## Pricing hypothesis (validate in beta)

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | 3 books, unlimited highlights and notes, review, 30 AI actions a month |
| Pro | ~$10/mo or ~$84/yr | Unlimited books, ~1,000 AI actions a month (fair use), OCR for scanned PDFs, Anki and annotated-PDF export, offline library |
| Student | Pro at ~40% off | Student verification and/or regional (purchasing-power) pricing |

Paywall moments: adding a 4th book, hitting the AI quota, exporting to Anki. The core reading loop stays free to build the habit.

## Out of scope for v1

Real-time co-annotation, native mobile apps (a PWA comes first), public sharing of PDF files (copyright exposure), LMS integrations, EPUB.
