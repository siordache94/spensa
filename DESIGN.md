---
name: Spensa
description: A shared household pantry app dressed as an airport departures board with a boarding-pass trip footer.
colors:
  alert-yellow: "#f5cc3b"
  alert-yellow-hover: "#fad557"
  ink: "#0b0d10"
  slate-panel: "#1c2127"
  hairline-dark: "#2a2f38"
  steel: "#6b7178"
  board-white: "#f2f2ee"
  board-grey: "#9aa0a8"
  urgent-red: "#ff4d4d"
  pass-paper: "#e6e8eb"
  pass-white: "#ffffff"
  pass-hairline: "#d3d6da"
  pass-grey: "#4a5058"
  pass-red: "#b91c1c"
  amoled-black: "#000000"
  amoled-panel: "#121212"
  amoled-hairline: "#2a2a2a"
  amoled-steel: "#8a8a8a"
  amoled-grey: "#d0d0d0"
typography:
  display:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  brand:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.01em"
  body:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.2
  figure:
    fontFamily: "Schibsted Grotesk, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum, lnum"
  label:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.14em"
  band:
    fontFamily: "Barlow Semi Condensed, Arial Narrow, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.14em"
rounded:
  xs: "4px"
  sm: "8px"
  md: "12px"
  xl: "16px"
  pill: "999px"
spacing:
  hair: "4px"
  sm: "8px"
  md: "16px"
  row-compact: "44px"
  row-airy: "72px"
  tick-compact: "28px"
  tick-airy: "56px"
components:
  button-primary:
    backgroundColor: "{colors.alert-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  button-primary-hover:
    backgroundColor: "{colors.alert-yellow-hover}"
  button-default:
    backgroundColor: "{colors.slate-panel}"
    textColor: "{colors.board-white}"
    rounded: "{rounded.sm}"
  panel:
    backgroundColor: "{colors.slate-panel}"
    textColor: "{colors.board-white}"
    rounded: "{rounded.md}"
  board-row:
    textColor: "{colors.board-white}"
    height: "{spacing.row-compact}"
    typography: "{typography.body}"
  board-row-held:
    backgroundColor: "rgba(245, 204, 59, 0.16)"
    textColor: "{colors.board-white}"
  column-head:
    backgroundColor: "{colors.slate-panel}"
    textColor: "{colors.board-grey}"
    typography: "{typography.label}"
    height: "24px"
  category-band:
    textColor: "{colors.board-white}"
    typography: "{typography.band}"
    height: "28px"
  trip-pass:
    backgroundColor: "{colors.slate-panel}"
    textColor: "{colors.board-white}"
    rounded: "{rounded.md}"
    height: "64px"
  cook-chip:
    textColor: "{colors.board-white}"
    typography: "{typography.label}"
    padding: "1px 6px"
  offline-badge:
    textColor: "{colors.alert-yellow}"
    rounded: "{rounded.pill}"
    padding: "5px 9px"
---

# Design System: Spensa

## Overview

**Creative North Star: "The Gate Board"**

Spensa's shopping surface is an airport departures board with a boarding pass pinned under it. Lists are strict columns, figures are tabular, categories are banded like gate groups, and a four-cell trip pass always says where the trip stands. The world refuses the category default of soft white cards with a green checkbox: panels are flat, edges are hairlines, and the checkbox is a square with a yellow fill and an ink check.

The system is built for one-handed use in a supermarket in bright light and in a dark kitchen at night. Contrast is high in every theme, tap targets are at least 44px, and there are three themes (light "pass paper", dark "ink and slate", AMOLED true black) and two densities (compact, airy). One softened alert yellow carries every "this needs you" meaning: active tab, partner activity, primary action, held rows, today, queued-offline. Red appears only for shortfall and error.

Key Characteristics:
- Flat tonal panels with 1px rules; no card shadows. The only shadow in the build floats the trip pass and its sibling dock button.
- Caps, tracked Barlow Semi Condensed for every label, head, band and tab; Schibsted Grotesk for names and numbers.
- Figures right-aligned in a fixed column with the unit left-aligned beside them.
- Yellow is a fill on light, and is also text only on dark and AMOLED.

## Colors

A near-monochrome ink, slate and steel palette with a single yellow. Values below are the dark theme unless named; per-theme values are token keys in the frontmatter and in `src/theme.css`.

### Primary
- **Softened Alert Yellow** (#f5cc3b): Primary button fill, checked tick fill, segmented indicator, active-tab underline, today marker, partner highlight, offline badge outline, focus ring (dark/AMOLED), text selection. Hover fill is #fad557. Text on yellow is always Ink. Mantine's yellow scale is anchored at shade 5 = #f5cc3b.

### Neutral (dark)
- **Ink** (#0b0d10): ground, header, and text on yellow.
- **Slate Panel** (#1c2127): panels, column heads, tab bar, trip pass, inputs, overlays.
- **Hairline** (#2a2f38): row dividers and panel borders.
- **Steel** (#6b7178): structural edges: header and tab bar borders, column-head rules, input borders, tick borders, pass cell dividers. Shared by all themes except AMOLED.
- **Board White** (#f2f2ee): primary text.
- **Board Grey** (#9aa0a8): secondary text, units, pack hints, column heads, done rows.
- **Urgent Red** (#ff4d4d): errors and the "short" square marker on planned meals.

### Neutral (light, "pass paper")
- Ground #e6e8eb, panels #ffffff, hairline #d3d6da, steel #6b7178, text Ink #0b0d10, secondary #4a5058, red #b91c1c. Yellow is never used as text: the accent token resolves to Ink (focus ring, active tab label, partner figure, notes).
- Contrast on paper: Ink on ground 15.9:1, secondary #4a5058 on ground 6.6:1 (8.1:1 on panel), red #b91c1c on ground 5.3:1 (6.5:1 on panel; the earlier #d92d2d was 3.9:1 and failed AA). Yellow on white is 1.55:1, so it is never a text or outline colour there; Ink on yellow is 12.6:1.

### Neutral (AMOLED)
- Ground #000000, panels #121212, hairline #2a2a2a, steel #8a8a8a, text #ffffff, secondary #d0d0d0, red #ff4d4d, accent yellow as in dark.

### Named Rules
**The One Alert Rule.** Yellow means attention or active and nothing else. Never a second accent hue; red is reserved for shortfall and error.
**The Fill-Only On Paper Rule.** On the light theme yellow is a fill behind Ink, never a text or outline colour (contrast). Use `--sp-accent` for anything that must be yellow on dark and Ink on light.
**The Ink On Yellow Rule.** Any yellow surface carries Ink text, in every theme.
**The Cue Chip Rule.** A cue that is yellow text on dark (a note, a partner name, "To confirm", today's count, the expiry hint) becomes a yellow fill with Ink text on light: a chip, not a tint. Cues that are yellow squares keep the square on light, filled yellow with a 1px Ink ring. Shared cues use the `.sp-cue` utility in `src/theme.css`: accent text on dark and AMOLED, yellow chip with Ink text on light. Elements that already sit on a yellow fill (today's band, the held row's wash) keep Ink text and need no chip.

## Typography

**Label/Heading Font:** Barlow Semi Condensed 600 (with Arial Narrow, sans-serif)
**Body/Figure Font:** Schibsted Grotesk 400/500/600/700 (with system-ui, sans-serif)

**Character:** Departure-board lettering for structure, a warm grotesk for the content being read. Both are loaded from Google Fonts in `index.html` (Barlow at 600 only).

### Hierarchy
- **Display** (700, 24px, 1.1, -0.02em, Schibsted): page title ("Shopping list").
- **Brand** (600, 20px, 1, 0.01em, Barlow): "Spensa" wordmark in the header.
- **Body / name** (500, 16px compact or 18px airy, 1.2): item and meal names. Muted notes under a name are 12px 500 in the accent colour.
- **Figure** (600, 16px compact or 30px airy, tabular lining numerals): amounts, right-aligned. Unit is 14px (16px airy) in secondary grey. Tabular figures are applied only to figure columns; the body default is lining numerals because tabular widens commas and full stops in this face.
- **Band** (600, 13px, 0.14em, caps, Barlow): category bands and "In the cart" head. Count at the right is 12px, 0.1em.
- **Day head** (600, 14px, 0.14em, caps, Barlow): plan day bands (13px on the 64em+ planner, where they share a row with the controls).
- **Label** (600, 12px, 0.14em, caps, Barlow): column heads, trip pass cell labels, tab labels (0.06em), slot names, "To confirm" and "Didn't cook" marks. The floor: nothing in the app sets text below 12px.
- **Small steps:** the 12px step is for caps sub-labels and sub-lines (labels, slot names, counts, pack hints, "Today" in a day head, the expiry hint, tab badges). The 14px step is for running text and units: prose notes (max 65ch), day heads, the unit beside a figure, the meal name on the planner. Neither step adds a new weight or face; they sit between the 13px band and the 16px body on the ramp.
- **Trip line** (600, 13px, 0.08em, caps, Barlow, secondary): date range and meal count under the title.
- **Pass figure** (600, 19px, tabular): the four trip-pass values.
- Prose notes are 14px with max 65ch.

### Named Rules
**The Caps Are Structure Rule.** Tracked caps Barlow marks structure (heads, bands, tabs, slots, field labels, badges). Names and amounts are never set in caps.
**The Figure Column Rule.** Numbers that line up are tabular and right-aligned in their own column; the unit sits left-aligned in the next.

## Layout

Mobile first, one column. The shop list is full-bleed: rows and bands run edge to edge (negative margin cancels the page gutter) with 16px inner padding. A single shared grid (`--cols`) aligns column heads, category bands and rows: tick cell (tick size + 16px), flexible name, amount (3x the amount font size), unit (44px), pack (60px). Trip setup meal rows use a three-column grid (tick, 64px slot, name). Plan days are full-bleed panels capped at 720px, each slot row a 64px / flexible / 44px grid.

Density is a root setting: compact (row 44px, tick 28px, amount 16px, name 16px) or airy (row 72px, tick 56px, amount 30px, name 18px, unit 16px, pack 13px). Spacing is a loose 4/8/12/16/24 rhythm; bands add 12px above. The list reserves 150px bottom padding (100px wide) for the pinned dock.

Navigation is a five-cell bottom tab bar on phones (PLAN, RECIPES, PANTRY, SHOP, INGREDIENTS). At 48em and up it becomes a side rail (48px rows) and the dock moves to the bottom of the content column (left 208px, max 640px). Below 380px tab labels tighten their tracking to 0.02em but stay at 12px.

## Elevation & Depth

Flat and tonal. Depth comes from panel-versus-ground contrast and 1px rules, not shadows. Header and tab bar are separated from content by Steel borders. The single exception is the trip pass and the floating dock button (`box-shadow: 0 4px 14px rgba(0,0,0,0.35)`), which lift off the scrolling list because they overlap it.

### Named Rules
**The Flat Board Rule.** Rows, bands, panels and cards carry no shadow. Only an element that floats above scrolling content may.

## Shapes

Mostly square and ruled, softened where a thing is touched. Ticks are 4px radius squares with a 2px Steel border; checked fills yellow with an Ink check. Buttons, inputs and the segmented control are 8px. Panels, overlays and the trip pass are 12px (Mantine `md` and `lg` both 12, `xl` 16). The offline badge is a full pill with a 1px yellow outline. Board rows, bands, column heads, day heads and cook chips are rectangles with no radius. Small status markers are hard squares (8px today marker, 6px red "short" marker), not dots.

## Components

### Buttons
- **Primary:** yellow fill (#f5cc3b), Ink text, 8px radius, weight 600; hover #fad557.
- **Default (secondary):** panel fill, Steel border, Board White text ("Edit trip", "Done shopping").
- **Subtle:** text-only ("Clear checked"). Disabled primary dims to a muted panel tone.
- **Focus:** 2px outline in the focus colour (yellow dark/AMOLED, Ink light), 2px offset.

### Board row
The core unit of the shop list. A grid row (min height 44 or 72px) with a bottom hairline: tick, name (with optional yellow note line such as "Staple, below min stock"), right-aligned figure plus unit, pack hint ("≈ 3 packs"). The whole row is a label, so tapping anywhere ticks; tapping the name opens the amount editor. **Done** rows (in the cart) dim name and figure to secondary grey. **Held** is described below.

### Column head and category band
Column head: 24px slate strip with Steel top and bottom rules, labels ITEM / AMOUNT / PACK aligned to their columns. Category band: 28px, caps, Steel bottom rule, "n to buy" at right in secondary grey. The cart head is the same voice with a 44px minimum height and a Clear action.

### Trip pass (signature)
Pinned above the tab bar (bottom 68px, 8px side inset): a 64px, 12px-radius slate panel with a Steel border split by Steel dividers into four cells, LEFT, IN CART, PARTNER, QUEUE (columns 0.8 / 0.9 / 1.5 / 1fr). Each cell is a tiny caps label over a 19px tabular value. The partner cell shows the last partner-ticked item and its relative time in the accent colour. Queue reads "synced" when empty, else a count. It floats with the soft shadow.

### Held partner highlight (signature)
A cart row whose tick came from the partner stays lit: 16% yellow wash with a 1px inset yellow outline, plus a note line "ticked by partner · just now" in the accent colour. An invisible full-row button acknowledges it, which clears the highlight. On light the wash is 50% yellow and all text goes Ink.

### Today band (signature)
Plan day heads are 32px caps bands. Today's gets an 8px square yellow marker and yellow text on dark and AMOLED; on light the whole band fills yellow with Ink text and an Ink marker.

### Cook chip (signature)
A small boxed label on a planned meal saying who cooks: 1px Steel border, no radius, 1px 6px padding, 13px Barlow 600 caps-tracked, truncating with ellipsis. The word "Cook" is set in secondary grey caps inside it.

### Plan meal row
Slot name (caps, 64px column) then a stack of meal buttons: name 16px 500, then marks. A "short" mark has a 6px red square; an "expiring" mark is a 1px yellow bordered tag (a yellow fill with Ink text on light). A 44px square "+" add button in the accent colour closes each slot row.

### Inputs
Panel fill, 1px Steel border, 8px radius. Focus swaps the border to the focus colour and adds a matching 1px outline. Error switches the border to red. Labels are caps Barlow 13px, tracked, secondary grey. Mantine's Autocomplete and NumberInput inherit this; number inputs use tabular figures.

### Navigation
Bottom tabs: icon over 12px caps label, secondary grey; active label is yellow (dark/AMOLED) or Ink (light) with a 3px yellow underline. Side rail variant on wide screens uses a 14% yellow wash for active (full yellow fill on light).

### Segmented control, badge, menu, accordion, overlays
Segmented: panel track with 1px rule, yellow indicator, Ink bold active label, 40px label height. Badge: caps Barlow 0.1em. Menu items 44px min, rule-coloured hover. Accordion hover is the rule colour. Modals, drawers, popovers and dropdowns use the panel with a 1px rule border and a Barlow heading.

### Pantry save bar
The Pantry page opens in read mode: one flat hairline row per ingredient (name left, total figure plus unit right, count items without a unit), compact sub-lines such as "300 g · expires 29 Nov" when there are several batches or an expiry, and the expiry hint (6px square marker, caps) when a batch is expired or inside the expiring window. A 44px pencil beside the title enters edit mode: category bands per ingredient, batch rows (stepper, expiry, remove) and the help text. In edit mode the pinned panel (same position and shadow as the dock: bottom 68px on phones, content column bottom at 48em and up) is always shown: primary "Save changes" (disabled until something changes) and default "Discard" ("Cancel" while unchanged). Saving or leaving returns to read mode.

### Offline badge
Header pill, 12px caps Barlow 0.1em, accent text, 1px yellow outline, shown while ticks are queued. On light it is a yellow fill with Ink text and no outline (Cue Chip Rule).

### Plan week navigator
Header row above the plan: Previous and Next are 44px icon buttons (chevrons, labelled for screen readers), "This week" and "Slots" are 44px text buttons. The date range carries a relative label beside it in 13px caps secondary grey: "This week", "Next week", "Last week", "In 2 weeks", "3 weeks ago".

## Do's and Don'ts

### Do:
- **Do** align every figure to the shared board grid and use tabular numerals only in figure columns.
- **Do** put yellow behind Ink text, and use `--sp-accent` where yellow-on-dark must become Ink-on-light.
- **Do** keep rows at least 44px (compact) and size ticks and amounts from the density variables, never hard-coded.
- **Do** use hairline rules and panel-versus-ground contrast for separation.
- **Do** make state legible without colour alone: the held row carries a text note, the partner cell carries a name, the offline badge carries a word.

### Don't:
- **Don't** use soft white cards with rounded checkboxes or a green success colour; the world rejects the category default.
- **Don't** add a second accent hue; red is only for shortfall and error.
- **Don't** put yellow text or outlines on the light theme.
- **Don't** add shadows to rows, bands or panels; only floating dock elements have one.
- **Don't** set names or amounts in caps, or labels in the grotesk.
- **Don't** use dot markers or glyph icons for status; markers are small hard squares and words.
