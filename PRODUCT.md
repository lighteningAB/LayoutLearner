# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, served equally:

- People retraining their typing: keyboard hobbyists and programmers moving from QWERTY to Dvorak, Colemak, Colemak-DH, Workman or a layout of their own, often on a new ortholinear or split board. They already touch-type and practise in repeated short sessions over weeks.
- People learning touch typing for the first time, for whom the layout is secondary and guidance matters more.

Both use a desktop or laptop with a physical keyboard. Phones get a notice; the product needs a hardware keyboard.

## Product Purpose

LayoutLearner teaches a keyboard layout on the physical board the learner owns. It generates a course for the chosen layout, runs a typing test, and shows which finger presses which key. Success is a learner who reaches for keys with the right finger without looking, and whose speed and accuracy on the new layout keep rising.

## Positioning

3D hands show which finger reaches where, on the learner's real board (ANSI 60%, full size, ortholinear, split boards with thumb clusters and firmware layers, imported QMK/ZMK/Vial keymaps), for any layout including custom ones, without changing OS keyboard settings.

## Operating Context

- Routes: typing test (`/`), course map and lessons (`/learn`, `/learn/[lessonId]`), layout gallery, detail and editor (`/layouts`), settings (`/settings`), privacy.
- Sessions are keyboard-driven: hands stay on the keys, eyes move between the text, the keyboard guide and the hands.
- Guides are scaffolding: the 3D hands, the 2D keyboard and the finger colours can each be switched off as the learner improves.
- "Emulate layout" translates physical key presses so the OS can stay on QWERTY.
- A command palette (`Ctrl/Cmd+K`, `Esc`) reaches pages, themes, settings and test modes.

## Capabilities and Constraints

- Typing test: time and words modes, three word lists, optional punctuation and numbers, live WPM and accuracy, results chart, weak-key drill.
- Lessons: generated per layout, home row first, graded 1 to 3 stars, all open from the start.
- 3D hands over a 3D keyboard reach for the next key with the correct finger; a 2D keyboard is the fallback when WebGL is unavailable. Hands must stay see-through enough that key legends under them remain readable.
- Ten finger colours map keys to fingers; they are a learning aid the user can switch off.
- Layout gallery with analysis, custom layout editor, momentary firmware layers, keymap import.
- Two themes, one dark and one light, following the OS by default.
- Optional accounts (GitHub, Google) sync progress, settings and custom layouts; off unless the deployment configures them.
- Stack: Next.js 15, React 19, Tailwind v4 with CSS custom property tokens, three.js via react-three-fiber. Deployed on Vercel from `main`.

## Brand Commitments

- Name: LayoutLearner (wordmark "layoutlearner" / "Layout Learner").
- Free and open source. No ads, no paywall. Accounts are optional.
- Data is never sold or used for profit. The product may record usage and typing stats to run and improve itself; that is not "tracking" in the commitment's sense. Design and copy must not claim "no data collected", and must never imply data is sold.

## Evidence on Hand

- Screenshots in `docs/screenshots/`, README feature descriptions, live site at https://layout-learner.vercel.app.
- No testimonials, user counts, benchmarks or press exist. Do not invent any.

## Product Principles

1. The hands are the teacher: the 3D hands and the key they reach for are the centre of every practice surface.
2. Function before spectacle: nothing may hide the next key, the typing text or the finger that owns a key.
3. Hands stay on the keyboard: every action is reachable by keys, and shortcuts are always discoverable.
4. Scaffolding comes off: every guide can be removed as skill grows, and the interface stays whole without it.
5. Honest and open: no dark patterns, no invented proof, no pressure mechanics.

## Accessibility & Inclusion

- WCAG AA contrast in both themes: 4.5:1 for body text, 3:1 for large text and UI components.
- Fully keyboard-operable, with visible focus.
- Honour `prefers-reduced-motion`.
- Finger identity is never carried by colour alone; a label or position carries it too.
