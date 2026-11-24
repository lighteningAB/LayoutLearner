---
name: LayoutLearner
description: A living engineering drawing of hands on a keyboard, drafted on a cyanotype sheet (Blueprint) or drafting paper (Whiteprint).
colors:
  sheet: "#243c60"
  sheet-alt: "#2a4369"
  key-fill: "#33507c"
  chalk: "#e6ecf7"
  chalk-sub: "#adbedc"
  rule: "#8299c4"
  hairline: "#4f6692"
  safety-yellow: "#f0c252"
  on-yellow: "#16263f"
  error-pink: "#f4b6bd"
  error-alt: "#ee8b97"
  success-mint: "#a3dfbb"
  finger-0: "#e0aad9"
  finger-1: "#dfa977"
  finger-2: "#bbd07a"
  finger-3: "#5ec1b7"
  finger-4: "#ece8f9"
  finger-5: "#cabcef"
  finger-6: "#9dbbe8"
  finger-7: "#7dc6e1"
  finger-8: "#e1daa0"
  finger-9: "#88c893"
  whiteprint-paper: "#f4f6fa"
  whiteprint-paper-alt: "#e9eef6"
  whiteprint-key-fill: "#ffffff"
  whiteprint-ink: "#1f3f77"
  whiteprint-ink-sub: "#4a6394"
  whiteprint-rule: "#6a84b3"
  whiteprint-hairline: "#c7d3e6"
  whiteprint-red-pencil: "#b5433a"
  whiteprint-on-red: "#ffffff"
  whiteprint-error: "#a3127a"
  whiteprint-error-alt: "#c458a6"
  whiteprint-success: "#17734a"
  whiteprint-finger-0: "#3e5a2a"
  whiteprint-finger-1: "#b85c00"
  whiteprint-finger-2: "#4f8212"
  whiteprint-finger-3: "#0a8573"
  whiteprint-finger-4: "#7459c2"
  whiteprint-finger-5: "#586273"
  whiteprint-finger-6: "#3558cc"
  whiteprint-finger-7: "#0878b8"
  whiteprint-finger-8: "#8f7400"
  whiteprint-finger-9: "#9a5a3c"
typography:
  title:
    fontFamily: "Josefin Sans, Century Gothic, Avenir Next, sans-serif"
    fontSize: "clamp(2.125rem, 1.4rem + 2.6vw, 3.75rem)"
    fontWeight: 300
    lineHeight: 0.95
    letterSpacing: "0.06em"
  heading:
    fontFamily: "Josefin Sans, Century Gothic, Avenir Next, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "0.1em"
  lettering-lg:
    fontFamily: "Josefin Sans, Century Gothic, Avenir Next, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.09em"
  lettering:
    fontFamily: "Josefin Sans, Century Gothic, Avenir Next, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.09em"
  lettering-sm:
    fontFamily: "Josefin Sans, Century Gothic, Avenir Next, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.08em"
  body:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.005em"
  readout:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontFeature: "tabular-nums slashed-zero"
    letterSpacing: "0"
  note:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.6875rem"
    lineHeight: 1.4
    letterSpacing: "0.02em"
  numeral:
    fontFamily: "Josefin Sans, Century Gothic, Avenir Next, sans-serif"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.02em"
rounded:
  none: "0px"
spacing:
  card-sm: "12px"
  card-md: "20px"
  card-lg: "24px"
  gutter: "16px"
  gutter-sm: "32px"
  gutter-lg: "40px"
components:
  button-primary:
    backgroundColor: "{colors.safety-yellow}"
    textColor: "{colors.on-yellow}"
    typography: "{typography.lettering-lg}"
    rounded: "{rounded.none}"
    height: "40px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.chalk}"
    textColor: "{colors.sheet}"
  button-subtle:
    backgroundColor: "transparent"
    textColor: "{colors.chalk}"
    rounded: "{rounded.none}"
    height: "40px"
    padding: "0 16px"
  button-subtle-hover:
    backgroundColor: "{colors.chalk}"
    textColor: "{colors.sheet}"
  button-danger:
    textColor: "{colors.error-pink}"
    rounded: "{rounded.none}"
    height: "40px"
    padding: "0 16px"
  card-solid:
    backgroundColor: "{colors.sheet-alt}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.none}"
    padding: "{spacing.card-md}"
  input:
    textColor: "{colors.chalk}"
    rounded: "{rounded.none}"
    height: "40px"
    padding: "0 12px"
  badge-main:
    backgroundColor: "{colors.safety-yellow}"
    textColor: "{colors.on-yellow}"
    typography: "{typography.lettering-sm}"
    rounded: "{rounded.none}"
    height: "22px"
    padding: "0 6px"
  kbd:
    backgroundColor: "{colors.key-fill}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.none}"
    height: "24px"
    padding: "0 6px"
---

# Design System: LayoutLearner

## Overview

**Creative North Star: "The Living Drawing"**

The app is an engineering drawing of hands on a keyboard. The drawing sheet is the page and the hands are the plate at its centre. It is drafted twice: **Blueprint** (dark, a deep, muted blueprint-blue sheet with soft chalk linework and a warm yellow action) and **Whiteprint** (light, pale drafting paper with blue ink and a brick-red action). Both themes are one system. The same tokens are re-valued under `[data-theme]`, and nothing else changes.

Everything is ruled and lettered, calm enough to practise in for an hour: corners are eased, the grid is barely there, and colour is saved for the key that matters. Boxes are 1px outlines. Labels are tracked capitals. Practice screens are minimal: the text, the hands and one small counter, with nothing beside the work. The page carries a faint drafting grid, leader lines and dimension-style labels; there is no sheet frame. Ten finger colours appear only as fills on keys, fingertips, chips and legends, which keeps them readable as a learning aid.

Where the build and the original direction contract differ on exact values, the build is recorded here (for example the Blueprint error is a pale pink, `#f4b6bd`, not salmon, and Whiteprint's red pencil is `#b5433a`).

**Key Characteristics:**
- Corners eased by 3px on controls, cards and keys; depth comes from line weight and fill, never shadow.
- Minimal practice screens: text, hands, counter. If it does not help the next keystroke, it is not on the page.
- Quiet by default: a deep low-chroma sheet, soft chalk lines, muted finger colours, a barely-there grid. Only the next key and the action colour may raise their voice.
- One action colour per theme, used for the primary action, the active tab rule, the caret, the focus ring and the selection.
- Josefin Sans tracked capitals for all lettering, Barlow Semi Condensed for UI text, IBM Plex Mono for typed text, key legends and numbers.
- A 10px drafting grid with a heavier line every 50px, on the body of every page.
- Ten finger colours on keys and hands only.

## Colors

A drenched monochrome blue sheet with a single saturated action colour. Whiteprint inverts to blue ink on near-white paper with red pencil as the action. Theme tokens are exposed as CSS custom properties (`--bg`, `--text`, `--main` and so on) and mapped into Tailwind (`bg-bg`, `text-main`, `border-line`).

### Primary
- **Safety Yellow** (`--main`, #f0c252 on Blueprint): the primary button face, the active nav rule, the slider fill, the caret, the focus ring, the selection and the `main` badge. Text on it is Deep Chart Navy (#16263f).
- **Red Pencil** (`--main`, #b5433a on Whiteprint): the same roles, with white text on it.

### Secondary
- **Sheet Blue** (#243c60), **Sheet Blue Alt** (#2a4369) and **Key Fill Blue** (#33507c): page, raised card and key surfaces on Blueprint. Whiteprint uses Drafting Paper (#f4f6fa), Paper Alt (#e9eef6) and White (#ffffff).

### Neutral
- **Chalk** (`--text` and `--line`, #e6ecf7): body text and all 1px linework on Blueprint. Blue Ink (#1f3f77) does both on Whiteprint.
- **Pale Chalk Blue** (`--sub`, #adbedc): secondary text. Whiteprint: #4a6394. It is not legible on the key fill in Blueprint, so use `--text` there.
- **Rule Blue** (`--border`, #8299c4): quiet borders and scrollbar thumbs. Whiteprint: #6a84b3.
- **Hairline Blue** (`--hairline`, #4f6692): the faintest dividers. Whiteprint: #c7d3e6.
- **Grid** (chalk at 4% and 8.5%; ink at 4.5% and 9.5% on Whiteprint): the drafting grid. **Fill** (6% and 12%): input and hatching fills. **Scrim** (#091e44 at 74%; ink at 42% on Whiteprint): modal backdrop.

### Status
- **Error** (#f4b6bd, alt #ee8b97; Whiteprint #a3127a, alt #c458a6) and **Success** (#a3dfbb; Whiteprint #17734a). Errors deliberately sit outside the finger-colour family.

### Finger colours
Ten fills, `--finger-0` to `--finger-9`, left pinky to right pinky. Blueprint values are light and bright (#e0aad9, #dfa977, #bbd07a, #5ec1b7, #ece8f9, #cabcef, #9dbbe8, #7dc6e1, #e1daa0, #88c893). Whiteprint values are deeper inks (see frontmatter). `--finger-fg` (#16263f on Blueprint, white on Whiteprint) is the text colour on any finger fill. Key tints mix the finger colour into the key base at 24% (Blueprint) or 16% (Whiteprint).

### Named Rules
**The One Action Rule.** One saturated colour per theme carries the action. The finger colours are not actions and never decorate chrome.

**The Fingers-Only Rule.** Finger colours appear only as fills on keys, fingertips, chips and legends. They never colour headings, borders, buttons or status.

**The Contrast Floor Rule.** Text and sub are at least 4.5:1 on the sheet and raised fills; `--border` is at least 3:1; `--finger-fg` is at least 4.5:1 on every finger fill. Check new values against these.

## Typography

**Display Font:** Josefin Sans (300, 600, 700; fallbacks Century Gothic, Avenir Next)
**Body Font:** Barlow Semi Condensed (400 and 500; the 500 file also answers 600 and 700; fallbacks Arial Narrow, system-ui)
**Label/Mono Font:** IBM Plex Mono (400 and 600; the 600 file also answers 500 and 700)

**Character:** Geometric, tracked capitals set against a condensed, workmanlike sans, with monospace for everything measured. It reads like sheet lettering on a drawing.

### Hierarchy
- **Title** (300, clamp(2.125rem, 1.4rem + 2.6vw, 3.75rem), 0.95, 0.06em, uppercase): one per page. Class `ll-title`.
- **Heading** (600, 1.25rem, 1.15, 0.1em, uppercase): section headings on the sheet. Class `ll-heading`.
- **Lettering lg / md / sm** (600, 0.875 / 0.75 / 0.6875rem, 1.25, 0.09 / 0.09 / 0.08em, uppercase): tabs, nav, buttons, labels, table heads, badges. Classes `ll-lettering-lg`, `ll-lettering`, `ll-lettering-sm`.
- **Body** (Barlow 400, 16px, 1.5, 0.005em): UI and prose. Secondary lines are 14px in `--sub`.
- **Readout** (Plex Mono, tabular nums, slashed zero): WPM, accuracy, error counts and the typing text. Class `ll-readout`.
- **Numeral** (Josefin 300, lining and tabular, 1, -0.02em): the timer and big counts. Class `ll-numeral`.
- **Note** (Plex Mono, 0.6875rem, 1.4, 0.02em): scale, units and ids in the margin. Class `ll-note`.

### Type ramp
Every font size is one of thirteen steps, defined as `--fs-*` in `app/globals.css` and exposed as Tailwind `text-*` utilities (the ramp replaces Tailwind's default scale; sizes set no line-height).

| Utility | Size | Typical use |
|---|---|---|
| `text-2xs` | 11px | notes, small lettering, chart labels |
| `text-xs` | 12px | lettering, captions |
| `text-sm` | 13px | dense mono readouts, compact rows |
| `text-md` | 14px | secondary copy, controls |
| `text-base` | 16px | body |
| `text-lg` | 18px | lead copy, wordmark |
| `text-xl` | 20px | headings, small numerals |
| `text-2xl` | 24px | key legends, lesson headings |
| `text-3xl` | 32px | stat numerals |
| `text-4xl` | 40px | counters |
| `text-5xl` | 56px | timer (narrow), key figures |
| `text-6xl` | 72px | result headline (narrow), 404 |
| `text-7xl` | 96px | timer and result headline (wide) |

Exceptions: the fluid page title clamps, the user-set typing text size, `em`-relative units beside numerals, and 2D keyboard legends that scale with the key unit.

### Named Rules
**The On-Ramp Rule.** No literal font sizes (`text-[14px]`, `font-size: 13px`). Pick a ramp step.

**The Lettered Caps Rule.** Display type is always uppercase and tracked. Lowercase Josefin is not used.

**The Mono Is Measurement Rule.** Anything typed, keyed or counted is Plex Mono with tabular figures. Prose never is.

## Layout

A single sheet column: `max-width: 1440px` with 16px, 32px and 40px side margins at base, `sm` and `lg`. Nav, main and footer share the column so their edges align. Pages that need a narrower measure constrain themselves inside it. The header strip is 64px tall at `md` and up, with the wordmark left, lettered nav tabs, then the layout chip, command palette and account on the right. The body is the drafting grid (10px fine, 50px heavy, offset 2px). The test page and the lesson drill are one centred column (`max-width: 1040px`): settings line (fades while typing), a small counter in the action colour, the text, the hands plate, a restart control. Live speed and accuracy are not shown while typing; they appear on the results sheet and stay in the page for assistive tech only. Spacing follows Tailwind's 4px steps; cards use 12, 20 or 24px padding. Phones get a notice plus browsing, and a mobile composition is not designed yet.

## Elevation & Depth

Flat. There are no shadows, glows or gradients (`--shadow-pop` resolves to nothing). Depth comes from three things: a filled plate with a line-weight outline (`border-line` on `bg-alt`) against hairline boxes with no fill, the drafting grid showing through, and hatching, which marks "pending" and "busy". Overlays use a scrim of the sheet colour. The 3D hands are a see-through veil with a silhouette outline, and legends are drawn above them with a cap-coloured halo so they stay readable.

### Named Rules
**The No-Shadow Rule.** A surface is separated by a rule or a fill step, never a shadow. Do not add `box-shadow` or `drop-shadow`.

**The Hatch Means Pending Rule.** 135-degree 1px hatching at 6px pitch (`ll-hatch`) means busy or not there yet. It carries no other meaning.

## Shapes

Nearly square. All radius tokens (`ui-sm`, `ui`, `ui-lg`) resolve to `--radius: 3px`, used on buttons, inputs, cards, menus, badges, toggles and 2D keys (`rounded-ui`). Page rules, plates and tables stay square. Borders are 1px, solid for live elements and dashed for disabled ones. A dashed outline with no fill is the disabled state (a hidden line). The slider is a dimension line with end ticks, a 3px measured part and a 10x18 square marker. Focus is a 2px outline in the action colour with a 2px offset.

## Components

### Buttons
- **Shape:** square, 1px outline, lettered caps (Josefin 600, tracking 0.08em). Heights are 32, 40 and 48px (`sm`, `md`, `lg`); `md` has 16px horizontal padding.
- **Primary:** action fill (`--main`), `--main-fg` text, chalk outline. Hover inverts to chalk fill with sheet-coloured text.
- **Subtle (default):** outline only. Hover fills with chalk.
- **Ghost:** no border, `--sub` text, underlined on hover. **Danger:** error-coloured outline, filled on hover.
- **States:** pressed drops the label 1px. Disabled is a dashed border with no fill. Busy runs hatching across the face.

### Cards / Containers
- **Solid:** 1px `--line` outline over `--bg-alt`. **Outline:** 1px `--border`, no fill. Square, no shadow. Padding is 12, 20 or 24 to 32px. Titles use `ll-lettering-lg`.

### Inputs / Fields
- **Style:** 1px `--border`, `--fill` background, square, 40px high (32px small), Barlow 16px, optional mono.
- **Focus:** the border goes to `--line` and the fill clears. Invalid is an error border plus a 2px error outline. Disabled is dashed and transparent.

### Navigation
- Lettered tabs (`ll-lettering-lg`, numbered 01 to 04) on a ruled strip. The active tab has a 2px action-colour underline and chalk text. Inactive tabs are `--sub` and gain a `--border` underline on hover. The layout chip is a 32px outlined box that fills with chalk on hover. Tabs, segmented controls and menus use roving tabindex and arrow keys.

### Badges and Kbd
- **Badge:** 22px, 1px outline, `ll-lettering-sm`. Tones are neutral, main (filled), success and error.
- **Kbd:** an outlined key cell on `--key-bg`, 24px high (20px small), Plex Mono 12px, `--key-border` outline. Used for hints such as tab + enter.

### The Plate (signature)
The 3D scene is drawn as a drafted line drawing on a transparent canvas, so the sheet and its grid show through. It is unlit: no lights, no shadows, no gradients. Every colour is read from the theme tokens (`--bg`, `--key-bg`, `--key-border`, `--key-text`, `--main`, `--error-alt`, `--finger-0..9`), so both themes work with no scene changes.
- **Keyboard:** flat unlit caps and a flat plate in the sheet's fill tones (`--key-bg`). Every outline is a constant-width screen-space line in the line colour (1.25px caps, same weight on any canvas size or pixel ratio). Cap corners are near-square (0.05 key units). Side walls are toned 30% toward the line colour. Idle keys take a 20% wash of their finger colour when finger colours are on.
- **Key states:** the target key is filled solid in its finger colour (the action colour if it has no finger) inside a heavy 3px frame. Held keys, up to three, get a dashed 2.25px frame and a 62% finger fill. A press flashes the whole cap as a hard switch with no fade, to the action colour when correct or `--error-alt` when wrong. Legends on those filled caps switch between `--bg` and `--text`, whichever contrasts more.
- **Hands:** a see-through veil in the sheet's own tone, so the hand reads as a region of the drawing and not as an object lying on it. Contour lines run across the hand every 0.5 key units at 1px, fading out where the surface turns edge-on or crowds. A 2.75px silhouette outline in the line colour is heavier than the key outlines, like an object line over construction lines. Fingertips take the full finger colour. The reaching finger gets a 45% wash and a thicker outline in its colour, and a finger holding a key gets 55% of that emphasis. The forearm dissolves toward its far end. A depth pre-pass stops the hand showing through itself.
- **Legends above hands:** key legends are Plex Mono, drawn after all three hand passes (render order 14 against 10, 11 and 12). Neither the veil nor a line ever crosses a glyph. Each glyph has a halo in the colour of its cap (0.06 key units), so a hand line passing behind a legend is knocked out. Word legends use short forms (Bksp, Ctrl, Esc, PgUp).
- **Narrow canvases:** below 560px the camera frames the letter block instead of the whole board, so legends stay readable. If a word legend would draw smaller than 10.5px on screen, the caps carry single characters only, drawn larger.
- **Leader line:** a label strip of 28px sits above the canvas. The leader rises from the key at a fixed slant (a slant of up to 140px), turns at an elbow onto the strip and runs level 12px to the label, which extends toward the middle of the plate. It ends in a 2.5px dot at the key. Labels read as a finger swatch, a lettered finger name, an arrow and the key (for example "LEFT INDEX → T"). A held key gets a second, dashed leader and label, and when there is no room it is named inline after the first label. The line draws from label to key over 160ms (not with reduced motion). The overlay is decorative for assistive tech, because the same words are in the hint line.
- **Sizing:** `size="default"` is a 2:1 box up to `clamp(240px, 48dvh, 520px)` (5:2 up to `clamp(160px, 26dvh, 300px)` when compact, in the "both" view); `size="large"` (lessons) is 3:2 up to `clamp(260px, 52dvh, 580px)` (2:1 up to `clamp(180px, 30dvh, 340px)` when compact). Any ancestor can override with `--hands-height`, `--hands-aspect` or `--hands-max-height`, with no `!important`. The box keeps its final size from first paint, so nothing moves when the canvas appears.

### 2D Keyboard (fallback and "both")
The same drafted plate in CSS, sized in multiples of `--u` (one key unit). States are carried by line and fill only:
- **Idle:** outlined cell on `--key-bg`, mono legend. **Finger colours:** a 24% (Blueprint) or 16% (Whiteprint) tint of the finger colour; home keys are filled solid in it, with a short drafted tick under the legend.
- **Highlight (next key):** solid finger fill with `--finger-fg` text, inside a heavy outline (2px or 0.06u) in the action colour, standing off the key by about 0.035u. With finger colours off, the key is filled with the action colour itself.
- **Pressed / held:** inverted, with a line-colour fill and a sheet-colour legend. **Error:** solid `--error` fill. **Heat:** `--error` mixed into the key base by percentage. **Dim:** dashed outline, no fill, 55% opacity (a hidden line).
- **Interactive boards:** hover inverts the cap; focus is a 2px line-colour outline; a selected key has a heavy action-colour outline, and a corner flag marks a hand-set finger or home role.

### Motion
- Fast and spare: 140ms fade, 180ms pop, 220ms rise, all on `cubic-bezier(0.16, 1, 0.3, 1)`. The caret blinks with `steps(1)`. Theme changes cross-fade for 180ms. `prefers-reduced-motion` reduces all of it to near zero.

## Do's and Don'ts

### Do:
- **Do** re-value tokens under `[data-theme]` for any new colour. Add it to both Blueprint and Whiteprint, and check the contrast floor.
- **Do** use the type utilities (`ll-title`, `ll-heading`, `ll-lettering*`, `ll-readout`, `ll-numeral`, `ll-note`) instead of ad-hoc sizes.
- **Do** use `ll-trim` on single-line caps inside fixed-height controls so they sit optically centred.
- **Do** show state with line style: dashed means disabled, hatched means busy or pending, and a thicker line means selected or measured.
- **Do** use `--text` rather than `--sub` for text on `--key-bg` in Blueprint.

### Don't:
- **Don't** add shadows, glows, gradients or rounded corners.
- **Don't** use finger colours for chrome, status or decoration.
- **Don't** set display type in lowercase or untracked, or use a system display face.
- **Don't** hide key legends behind hands or overlays: legends draw after the hand passes, with a cap-coloured halo.
- **Don't** light the 3D scene, add shadows, or give the hands an opaque fill.
- **Don't** build new surfaces as dark-slate cards with a neon accent. The sheet and its linework are the page.

*Note:* where the direction contract's older values (salmon error, #B3CBF0 sub, #D6302A red pencil) differ from the built tokens, the built tokens above win.
