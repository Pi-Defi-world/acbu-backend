# Bugfix Requirements Document

## Introduction

The `tw-animate-css` library (imported globally in both `app/globals.css` and `styles/globals.css`) ships animation utility classes — `animate-in`, `animate-out`, `slide-in-from-*`, `fade-in-*`, `zoom-in-*`, and their counterparts — that set `will-change: transform` on matched elements. These classes are applied across a wide set of UI components (dialogs, sheets, drawers, popovers, dropdowns, tooltips, toasts, carousels, command palettes, context menus, and alert banners), meaning many DOM nodes carry the hint simultaneously.

`will-change: transform` instructs the browser to promote an element to its own GPU compositor layer ahead of time. When only a handful of actively-animating elements hold this hint, the trade-off is net positive. When dozens of elements hold it concurrently — including ones that are currently static, closed, or only ever animate once — it causes persistent GPU memory bloat. On lower-end or memory-constrained devices this manifests as degraded scroll performance, janky rendering during page transitions, and in extreme cases, tab crashes.

The fix must surgically scope `will-change` so that it is present only while a transform animation is actively running, and absent at rest.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an element has any `animate-in` or `animate-out` Tailwind class applied (e.g. `animate-in fade-in slide-in-from-top-2`) THEN the system sets `will-change: transform` on that element for the entire lifetime of the class, including when the element is fully visible and static at rest.

1.2 WHEN multiple animated components are present in the DOM simultaneously (e.g. an open dialog behind an open dropdown next to a toast notification) THEN the system promotes each of those elements to a separate GPU compositor layer, multiplying GPU memory consumption beyond what is needed.

1.3 WHEN a component that uses `animate-in`/`animate-out` classes finishes its entry animation and reaches a steady, non-animating state THEN the system retains `will-change: transform` indefinitely, preventing the browser from reclaiming the reserved GPU memory for that layer.

1.4 WHEN `will-change: transform` is set on elements that only apply opacity or filter transitions (i.e. no actual transform change occurs) THEN the system unnecessarily promotes those elements to a compositor layer, wasting GPU memory for a hint that offers no benefit.

1.5 WHEN many components across different routes each carry `animate-in`/`animate-out` classes THEN the system accumulates GPU compositor layers globally, causing observable GPU memory bloat that degrades performance on lower-end devices.

---

### Expected Behavior (Correct)

2.1 WHEN an element's CSS transform animation is actively in progress THEN the system SHALL apply `will-change: transform` only for the duration of that animation, ensuring the GPU layer hint is scoped to the window in which it provides a genuine benefit.

2.2 WHEN multiple animated components are open simultaneously THEN the system SHALL limit the number of elements carrying `will-change: transform` at any one time to only those elements that are currently mid-animation, so GPU compositor layer count stays proportional to active animation count rather than open-component count.

2.3 WHEN a component's entry or exit animation completes THEN the system SHALL remove `will-change: transform` (or replace it with `will-change: auto`) so the browser can reclaim the GPU memory reserved for that compositor layer.

2.4 WHEN an element transitions only via opacity or filter (with no transform property animated) THEN the system SHALL NOT apply `will-change: transform` to that element, avoiding unnecessary compositor layer promotion.

2.5 WHEN the `prefers-reduced-motion: reduce` media query is active THEN the system SHALL ensure no `will-change: transform` hint persists on any element, since animations are disabled and no GPU pre-promotion is warranted.

---

### Unchanged Behavior (Regression Prevention)

3.1 WHEN an element is actively executing a CSS transform animation (e.g. a slide-in or slide-out transition on a sheet or dialog) THEN the system SHALL CONTINUE TO render that animation smoothly, with no visual regression in animation quality or timing compared to the current behavior.

3.2 WHEN `animate-in` / `animate-out` Tailwind classes are used on components such as dialogs, sheets, drawers, popovers, dropdowns, tooltips, and toasts THEN the system SHALL CONTINUE TO animate those components with their currently defined keyframes, durations, and easing curves.

3.3 WHEN an element uses `fade-in`, `fade-out`, `zoom-in-95`, or `zoom-out-95` animation utilities without any sliding transform THEN the system SHALL CONTINUE TO apply those opacity and scale transitions correctly.

3.4 WHEN the sidebar component transitions its `left` or `right` position via `transition-[left,right,width]` THEN the system SHALL CONTINUE TO animate the sidebar open/close smoothly, since this is a genuine continuous transform-like transition that warrants the optimization when active.

3.5 WHEN the global `prefers-reduced-motion` override in `globals.css` reduces animation durations to `0.01ms` THEN the system SHALL CONTINUE TO respect that override, and the scoped `will-change` approach SHALL NOT interfere with it.

3.6 WHEN components built on Radix UI primitives (dialogs, popovers, dropdowns) use `data-[state=open]` and `data-[state=closed]` attribute selectors for their animation classes THEN the system SHALL CONTINUE TO trigger animations correctly on state transitions.
