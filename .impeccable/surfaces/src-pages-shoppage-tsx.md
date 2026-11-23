---
version: 1
slug: "src-pages-shoppage-tsx"
primary_target: "src/pages/ShopPage.tsx"
related_targets: ["src/App.tsx"]
---

# Shop surface (and app shell)

Scope: the Shop tab (shopping trip setup + list) and the app shell it sits in (header, tab bar, settings). Visitor mode: Operate.
Audience and job: two people in a supermarket, one-handed, often offline, sometimes shopping at once on two phones. Job: pick which planned meals this trip covers, then tick items off with zero doubt about what's left.
Constraints: standard controls (Mantine), WCAG AA in light and dark, very high text contrast in AMOLED, tap targets >= 44px, undo over confirm.
Unresolved: whether the trip's meal selection is shared between the two phones (v1: per device).

## Direction contract

THESIS: The shopping list as a live departures board: strict columns, tabular figures, and a trip pass that always says where the trip stands. Refuses the category default of soft white cards with a green checkbox.

OWN-WORLD: Gate-board world. Ink #0B0D10 ground, slate #1C2127 panels, steel #6B7178 rules, off-white #F2F2EE text, one softened alert yellow #F5CC3B for active, attention, partner and primary; red only for urgency. Light theme = pass paper (#E6E8EB ground, white panels, ink text, yellow only as a fill). AMOLED = #000 ground, #FFF text, #D0D0D0 secondary. Barlow Semi Condensed 600 caps tracked for labels, heads and tabs; Schibsted Grotesk with tabular numerals for names and amounts. Density setting: compact (44px rows) or airy (72px rows, 56px tick, large amounts).

STORY: The shopper opens Shop, chooses the meals this trip is for (grouped by day, defaulting to the next N days from settings), and gets one board grouped by category. Ticking moves an item into the cart; a partner's tick arrives and stays lit; offline ticks queue visibly. They finish knowing nothing was missed.

FIRST VIEWPORT: Header: Spensa, offline badge (yellow outline) when ticks are queued, household menu. Title row "Shopping list" + trip summary ("Tue–Thu · 3 meals") + an "Edit trip" control; no range segmented control on the list. The days setting only pre-selects meals in trip setup. Column heads ITEM / AMOUNT / PACK over category bands with "n to buy". Rows: checkbox, name, right-aligned figure + left-aligned unit, pack hint. Pinned above the tab bar: the trip pass, four segments LEFT · IN CART · PARTNER · QUEUE. Tab bar: icon over caps label, active in yellow.

FORM: Board + trip footer, position 4 on the re-rolled structure list, merged with user steers (offline badge in header, thumb-rows size as density setting, meal-by-day trip setup, theme setting). seed:5335b9066acdc587

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
