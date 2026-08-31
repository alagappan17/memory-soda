---
name: docs-style
description: Docs writing rules for apps/docs — one mode per page, word budgets, kill list, inclusion test, two-pass prune, site-wide structural review. Use before writing or editing anything under apps/docs.
---

# Docs writing rules

Read this before writing or editing anything under `apps/docs`.

## 1. Every page has exactly one mode

Pick one before writing. Mixing modes is the main cause of bloat.

| Mode                                | Answers                      | Rules                                                                                          |
| ----------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| **Tutorial** — Getting started      | "Get me to a working thing"  | One happy path. No alternatives, no options, no "you could also". Ends in a verifiable result. |
| **How-to** — Guides                 | "I have a specific goal"     | Starts at a stated precondition, ends at a stated outcome. No concept teaching — link out.     |
| **Reference** — SDK, API, Reference | "What are the exact params?" | Signature, params, returns, errors, one example. No prose paragraphs. No rationale.            |
| **Explanation** — Concepts          | "Why is it built this way?"  | Design reasoning and trade-offs. No step-by-step. No full param tables.                        |

If a paragraph belongs to a different mode than its page, cut it and link instead.

## 2. Page budgets

- Reference page: no prose block longer than 3 sentences.
- Concept page: 400–800 words. Longer means it's two concepts.
- How-to guide: under 600 words. Longer means it's a tutorial.
- If two pages need the same 3 paragraphs, one page owns them and the other links.

## 3. Kill list — never write these

- Narrator asides about the doc itself: "Be clear about this before adopting", "Documented honestly, because...", "Note that", "It's worth mentioning", "As we'll see below".
- Restating the heading in the first sentence.
- Transitional glue: "Now that we've covered X, let's look at Y."
- "In this section we will..." / "This page covers..."
- Horizontal rules (`---`) between sections. Headings already separate them.
- Summary/recap sections. The reader just read it.
- Hedging on your own product: "generally", "typically", "in most cases" — either it does or it doesn't.
- Explaining a general concept the reader already knows (what a REST API is, what an embedding is). Link to a canonical source.
- Any parameter description that restates the parameter name (`userId` — "the ID of the user").

## 4. The inclusion test

For every paragraph, one of these must be true:

1. It prevents a mistake someone will actually make.
2. It answers a question the reader has _right now_, on this page.
3. It's the exact syntax/value they need to type.

If none apply, delete it. "It's good context" is not a reason.

## 5. What to include that most docs skip

These earn their space — keep and expand them:

- **What it is not** — the adjacent tools it will be confused with.
- **Known limitations** — stated plainly, before the reader hits them.
- **Poor fit** cases alongside good-fit cases.
- Real output, pasted verbatim, not paraphrased.
- Error messages users will actually see, matched to causes.

## 6. Two-pass workflow

Never write and prune in the same request.

**Pass 1 — draft.** State the mode from §1 up front. Draft against it.

**Pass 2 — prune.** New request, deletion only:

> Edit this page. You may only delete text and merge sentences. You may not add
> sentences, add headings, or rephrase for smoothness. Cut 30% of the words.
> Apply the kill list in DOCS_STYLE.md §3. For anything you keep that isn't
> obviously syntax or a limitation, name which inclusion test in §4 it passes.

Requiring a justification per kept paragraph is what forces real cuts. Asking
for "concise" does nothing.

## 7. Structural review (run on the whole site, not per page)

- Any two pages documenting the same surface? Merge or make one canonical.
- Any page under 150 words? Fold it into its parent.
- Any nav section with one item? Delete the section.
- Can a new user reach a working call in 3 clicks from the landing page?
