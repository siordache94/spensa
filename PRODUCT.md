# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two people sharing one household (the owner and their partner). They plan the week's meals on a phone or laptop at home, and use the phone in the supermarket with poor signal, often one-handed while holding a basket or trolley.

## Product Purpose

Spensa answers three questions for a household: what are we cooking this week, what's in the pantry (and what's about to expire), and what do we need to buy. Success is buying only what's missing, wasting less food, and spending little effort keeping the pantry accurate.

## Positioning

The plan drives the pantry. Planned meals count as eaten on their date, and stock is replayed from purchases, plans and corrections, so the shopping list falls out of the week's plan without anyone logging what they cooked.

## Operating Context

- Planning happens at home, at leisure, on a phone or laptop: a week view, Monday first, with lunch and dinner slots by default.
- Shopping happens in the supermarket on the phone: ticking items off one at a time, sometimes both people at once on two phones, sometimes offline.
- Pantry upkeep happens in the kitchen: quick "used", "set remaining", "finished" and "discard" corrections, and an occasional full inventory check.

## Capabilities and Constraints

- Recipes hold ingredients per portion (entered for "serves N" from 1, 2, 3, 4, 6, 8), "to taste" ingredients, markdown instructions and tags.
- Ingredients use one unit each: g, ml, count or to taste. Metric only, no unit conversion.
- Pantry stock is tracked per batch with optional expiry; "expiring soon" defaults to 3 days.
- Shopping list ticks sync live between phones and queue while offline.
- English UI only. Free tiers only (Supabase, Cloudflare). The code is public; data is private per household.
- Mobile-first installable web app (PWA); no native app.
- Terminology: see CONTEXT.md (ingredient, batch, planned meal, slot, adjustment, snapshot, replay).

## Brand Commitments

- Name: Spensa, from the Italian "dispensa" (pantry). The name is the only fixed brand element; colour, icon and typography are open. The scaffold's green and "S" icon are placeholders.

## Evidence on Hand

- No logo, photography, illustrations or testimonials exist. Do not fabricate them.

## Product Principles

1. Least friction wins: every pantry or list change should take one or two taps, with sensible pre-filled values.
2. The plan is the truth: the app assumes planned meals happened and makes correcting reality cheap rather than asking for confirmations.
3. Built for the supermarket aisle: one-handed, glanceable, forgiving of mis-taps (undo over confirm).
4. Two people, one pantry: shared state must stay obvious and in sync.

## Accessibility & Inclusion

WCAG AA contrast in dark and light mode, tap targets of at least 44px, readable on a phone in bright supermarket lighting.
