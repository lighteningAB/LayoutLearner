---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/learn/page.tsx","app/layouts/page.tsx","app/settings/page.tsx"]
---

# Surface brief: LayoutLearner app (all routes)

Scope: the whole app shell and its routes: typing test (`/`), Learn (`/learn`, lesson player, summary), Layouts (gallery, detail, editor, layers), Settings. Visitor mode: Operate. Build path: code-led (no image generation; approved static mock and real 3D render stand in as the reference).

Audience and job: learners of a keyboard layout, enthusiasts and first-time touch typists alike, practising with hands on a physical keyboard. Task: type the text, see which finger takes the next key, track progress. Constraints: WCAG AA in both themes, keyboard-first, reduced motion honoured, hands never hide key legends, no invented proof.

Memorable moment: line-art hands over a drafted keyboard, one fingertip and its key filled in that finger's colour, joined to a drafted label by a leader line.

Reference (approved by the owner): scratchpad `mockups/blueprint/` (`index.html`, `test.png`, `learn.png`) and the scene hack diff `blueprint-scene-hack.diff`.

Unresolved: mobile composition (phones only get a notice plus browsing), results view and layout editor were not mocked.

## Direction contract

THESIS: The app is a living engineering drawing of hands on a keyboard. It refuses the category default of a dark slate typing site with a neon accent and a keyboard in a box under the text; the drawing sheet is the page and the hands are the plate at its centre.

OWN-WORLD: Drenched cyanotype. `blueprint` theme: Prussian-blue sheet (#243c60), lighter blue fills (#33507c), chalk-white 1px linework (#e6ecf7), pale blue secondary text (#B3CBF0), safety-yellow action (#f0c252), salmon error (#FF8A78). `whiteprint` theme: white drafting paper (#f4f6fa), blue ink (#1f3f77), red pencil action (#D6302A). Square corners, hairline borders, faint drafting grid, registration marks, title block, sheet/detail numbering, leader lines, dimension-style labels. No shadows, no glows, no gradients. Type: Josefin Sans tracked caps for sheet lettering and headings, Barlow Semi Condensed for UI, IBM Plex Mono for typing text and key legends. Ten finger colours appear only as fills on keys, fingertips, chips and legends.

STORY: The learner sees their own board drawn as a plate, reads the next key from the filled finger and its leader label, types, and watches readouts update like annotations. They believe the tool knows exactly where each finger goes, and they start the next lesson or test.

FIRST VIEWPORT: Test page at 1440x900. Header strip: wordmark left, numbered nav (01 TEST … 04 SETTINGS), layout chip right, then the config row as underlined annotations. Three lines of 24px mono typing text upper centre-left; timer as large thin numerals upper right. Below, the 3D plate spans the centre at roughly half the viewport height: wireframe-outlined translucent hands over an outlined keyboard, target key and fingertip filled, leader line to "LEFT INDEX → T". Right rail: next-key detail box, WPM/ACC/ERR readouts, title block bottom right. Left rail: notes and command hints. Primary action is typing itself; restart hint (tab + enter) sits bottom left.

FORM: Technical drawing sheet with a central plate and marginal annotations. seed: none (pinned) — owner chose "Blueprint (Recommended)" from the round-2 mockups and "See-through always" for the hands.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
