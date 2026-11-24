# Bugfix Requirements Document

## Introduction

z-index values are scattered as magic numbers (`z-[1]`, `z-10`, `z-20`, `z-40`, `z-50`, `z-[100]`) across `app/globals.css` and the `components/` directory with no centralised scale or documented stacking contract. Because there is no single authoritative source of truth, the stacking order is non-deterministic: adding a new layered component (modal, tooltip, toast, or drawer) can silently render behind the fixed mobile navigation bar or collide with another overlay. The fix introduces a CSS custom-property token scale (`--z-*`) as the single source of truth for every layer, replaces all hardcoded values with the appropriate token, and documents the stacking order so future contributors know which layer to use.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a new overlay component (modal, sheet, drawer, or toast) is added using an arbitrary z-index value THEN the system renders it behind the mobile navigation bar (`z-40`) or another overlay of the same value because there is no enforced stacking hierarchy.

1.2 WHEN multiple overlay components with the same hardcoded `z-50` value are visible at the same time THEN the system produces indeterminate stacking order between them because no layer semantics distinguish dialogs, tooltips, and popovers.

1.3 WHEN a developer needs to position a new fixed or sticky element THEN the system provides no guidance on which numeric value to choose, causing them to guess or copy an existing magic number.

1.4 WHEN `z-[100]` is used for the toast container (`Toaster`) and `z-50` is used for the offline indicator and session-expiry banner THEN the system places system-critical banners below toasts, reversing the intended priority.

1.5 WHEN the sidebar resize handle uses `z-20` and the sidebar container uses `z-10` in close proximity THEN the system relies on implicit numeric ordering with no semantic label, making the intent opaque to maintainers.

### Expected Behavior (Correct)

2.1 WHEN a new overlay component is added THEN the system SHALL resolve its z-position by referencing a named CSS custom property token (e.g. `var(--z-modal)`) so the stacking order is always deterministic and consistent with every other component.

2.2 WHEN multiple overlay components of different semantic types are visible simultaneously THEN the system SHALL stack them according to their declared layer token, ensuring tooltips appear above modals and system alerts appear above toasts.

2.3 WHEN a developer needs to position a new fixed or sticky element THEN the system SHALL provide a documented stacking scale with named layers so the correct token can be chosen without guessing.

2.4 WHEN system-critical banners (offline indicator, session-expiry warning) are displayed alongside toasts THEN the system SHALL place the banners on a layer above toasts by assigning them a higher-priority token.

2.5 WHEN any component references a z-index value THEN the system SHALL use a `var(--z-<layer>)` token exclusively, with no hardcoded numeric magic numbers remaining in the codebase.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN sticky page headers scroll at the top of the viewport THEN the system SHALL CONTINUE TO appear above page content by remaining on the base sticky layer.

3.2 WHEN the mobile navigation bar is fixed at the bottom of the screen THEN the system SHALL CONTINUE TO render above page content and below all overlay layers.

3.3 WHEN a dialog, sheet, or drawer is opened THEN the system SHALL CONTINUE TO render its backdrop (scrim) and its panel at the correct overlay layer, covering the mobile navigation bar.

3.4 WHEN a tooltip or popover is triggered THEN the system SHALL CONTINUE TO float above the triggering element and above other non-modal content.

3.5 WHEN the sidebar toggle resize handle is visible THEN the system SHALL CONTINUE TO sit above the sidebar container panel.

3.6 WHEN the calendar, toggle-group, or button-group components apply a raised z-index on focus THEN the system SHALL CONTINUE TO elevate the focused element above its siblings within the same stacking context.

3.7 WHEN the navigation-menu indicator is rendered THEN the system SHALL CONTINUE TO appear at a near-baseline level below all navigation panel content.
