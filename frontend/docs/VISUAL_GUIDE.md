# ACBU Mobile App - Visual Style Guide

## Design System Overview

This guide shows exactly how components should look and behave on mobile devices.

## Color Palette

### Primary Colors
- **Primary:** `oklch(0.35 0.12 280)` - Deep Purple/Indigo
- **Secondary:** `oklch(0.75 0.06 280)` - Light Purple
- **Accent:** `oklch(0.55 0.15 160)` - Teal/Cyan

### Neutral Colors
- **Background:** `oklch(0.98 0 0)` - Off-White
- **Card:** `oklch(1 0 0)` - Pure White
- **Foreground:** `oklch(0.15 0 0)` - Near Black
- **Muted:** `oklch(0.92 0 0)` - Light Gray
- **Border:** `oklch(0.92 0 0)` - Light Gray

### Status Colors
- **Success:** Green-600 / Green-400 (dark)
- **Warning:** Amber-600 / Amber-400 (dark)
- **Error:** Red-600 / Red-400 (dark)
- **Info:** Blue-600 / Blue-400 (dark)

## Typography

### Font Stack
```css
--font-sans: 'Geist', system-ui, -apple-system, sans-serif;
--font-mono: 'Geist Mono', monospace;
```

### Font Sizes (Mobile First)
| Element | Size | Weight | Usage |
|---------|------|--------|-------|
| H1 Header | 18px (text-lg) | Bold (700) | Page titles |
| H2 Section | 16px (text-base) | Bold (700) | Section headers |
| H3 Subsection | 14px (text-sm) | Semibold (600) | List titles |
| Body Text | 14px (text-sm) | Regular (400) | Main content |
| Small Text | 12px (text-xs) | Regular (400) | Captions, meta |
| Amount Display | 24px (text-2xl) | Bold (700) | Balance, prices |
| Large Amount | 30px (text-3xl) | Bold (700) | Main balance |

### Line Heights (Mobile)
- Headers: `leading-tight` (1.25)
- Body: `leading-relaxed` (1.625)
- Forms: `leading-relaxed` (1.625)

## Spacing System

### Padding
```
p-1   = 4px
p-2   = 8px
p-3   = 12px  (card default)
p-4   = 16px  (container default)
p-5   = 20px  (large card)
p-6   = 24px
```

### Gaps & Margins
```
gap-1   = 4px
gap-2   = 8px
gap-3   = 12px   (default grid/list gap)
gap-4   = 16px

space-y-2 = 8px    (tight)
space-y-3 = 12px   (comfortable)
space-y-4 = 16px   (default)
space-y-5 = 20px   (relaxed)
space-y-6 = 24px   (large - avoid on mobile)
```

### Container Padding
```
Mobile:  px-4 py-4 = 16px sides, 16px top/bottom
Bottom:  pb-24 = 96px (navigation clearance)
Gap:     space-y-4 or space-y-5
```

## Border Radius

```
rounded-lg = 0.75rem (12px)  - Default for cards
rounded-full = 50%            - Avatars, badges
rounded-none = 0px            - Minimal design
```

## Components

### Card (Default Mobile)
```tsx
<div className="rounded-lg border border-border bg-card p-3 transition-colors active:bg-muted">
  {/* Content */}
</div>
```

**Size:** Full-width with px-4 padding
**Padding:** p-3 (12px) standard
**Border:** Subtle border-border color
**Hover:** bg-muted on hover
**Active:** scale-95 on touch (optional)

### Balance Card (Featured)
```tsx
<div className="rounded-lg border border-border bg-gradient-to-br from-primary/20 via-secondary/10 to-transparent p-5">
  <p className="text-xs font-medium text-muted-foreground">Total Balance</p>
  <h2 className="text-3xl font-bold text-foreground">AFK 4,084.50</h2>
</div>
```

**Size:** Full-width
**Padding:** p-5 (20px) for emphasis
**Gradient:** Subtle primary to secondary
**Text:** text-3xl for large balance

### List Item
```tsx
<div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
  <Icon className="w-5 h-5 flex-shrink-0 text-primary" />
  <div className="flex-1 min-w-0">
    <p className="truncate text-sm font-medium">Title</p>
    <p className="text-xs text-muted-foreground">Subtitle</p>
  </div>
  <Badge className="flex-shrink-0 text-xs">Status</Badge>
</div>
```

**Layout:** Horizontal flex with proper truncation
**Gap:** gap-3 (12px)
**Icon:** w-5 h-5, left-aligned, flex-shrink-0
**Content:** flex-1 min-w-0 (allows truncation)
**Action:** Right-aligned, flex-shrink-0

### Navigation Button
```tsx
<Link href="/send">
  <div className="flex flex-col items-center justify-center h-20 gap-1">
    <Send className="w-5 h-5 text-primary" />
    <span className="text-xs font-medium text-center">Send</span>
  </div>
</Link>
```

**Height:** h-20 (80px) for touch
**Icon:** w-5 h-5 (20px)
**Text:** text-xs (12px)
**Gap:** gap-1 (4px) between icon and text

### Quick Action Card (2-Column Grid)
```tsx
<div className="grid grid-cols-2 gap-3">
  <Link href="/send">
    <div className="bg-blue-100 dark:bg-blue-900/30 rounded-lg border border-border/50 p-4">
      <Send className="w-6 h-6 text-blue-600 dark:text-blue-400 mb-2" />
      <h3 className="text-sm font-semibold text-foreground mb-0.5">Send</h3>
      <p className="text-xs text-muted-foreground">Transfer money</p>
    </div>
  </Link>
</div>
```

**Grid:** grid-cols-2 gap-3 (2 columns, 12px gap)
**Padding:** p-4 (16px)
**Icon:** w-6 h-6 (24px)
**Spacing:** mb-2 between icon and title, mb-0.5 between title and desc

### Button (Full-Width, Mobile)
```tsx
<Button className="w-full h-auto px-4 py-3 bg-primary text-primary-foreground hover:bg-primary/90">
  Send Money
</Button>
```

**Width:** w-full (100%)
**Height:** h-auto py-3 (minimum 40px)
**Padding:** px-4 py-3 (16px, 12px)
**Touch:** Easy to tap with thumb

### Header (Sticky)
```tsx
<header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
  <div className="px-4 py-3">
    <h1 className="text-lg font-bold text-foreground">Page Title</h1>
    <p className="text-xs text-muted-foreground">Subtitle</p>
  </div>
</header>
```

**Position:** sticky top-0
**Z-Index:** z-10 (above content)
**Backdrop:** backdrop-blur-sm (glass effect)
**Padding:** px-4 py-3 (16px, 12px)

### Bottom Navigation
```tsx
<nav className="fixed bottom-0 left-0 right-0 border-t border-border bg-card z-40">
  <div className="flex justify-between items-center h-20 px-1">
    {/* Nav items */}
  </div>
</nav>
```

**Position:** fixed bottom-0 full-width
**Height:** h-20 (80px)
**Z-Index:** z-40 (below modals)
**Bottom Clearance:** Content should have pb-24

### Modal/Dialog (Bottom Sheet)
```tsx
{showModal && (
  <div className="fixed inset-0 z-50 flex items-end bg-black/50">
    <div className="w-full bg-card p-6 rounded-t-xl border-t border-border">
      {/* Content */}
    </div>
  </div>
)}
```

**Position:** Fixed, slides up from bottom
**Z-Index:** z-50 (above everything)
**Backdrop:** bg-black/50 (semi-transparent)
**Shape:** rounded-t-xl (rounded top corners only)

## Activity List Pattern

```tsx
<div className="space-y-2">
  {transactions.map((tx) => (
    <div key={tx.id} className="rounded-lg border border-border bg-card p-3">
      {/* Top row: Icon, description, date */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/30 flex-shrink-0">
          <ArrowDownLeft className="w-4 h-4 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{tx.description}</p>
          <p className="text-xs text-muted-foreground">{tx.date}</p>
        </div>
      </div>
      
      {/* Bottom row: Amount, status (indented) */}
      <div className="flex items-center justify-between pl-11">
        <p className="text-sm font-semibold text-green-600 dark:text-green-400">+AFK {tx.amount}</p>
        <Badge variant="outline" className="text-xs">{tx.status}</Badge>
      </div>
    </div>
  ))}
</div>
```

**Key:** `pl-11` indentation for secondary row = `p-2` (icon) + `gap-3` + `p-2` (icon width)

## Form Elements

### Text Input
```tsx
<Input
  type="text"
  placeholder="Enter amount"
  className="border-border text-sm h-10 px-3"
/>
```

**Height:** h-10 (40px) minimum
**Padding:** px-3 py-2 (12px, 8px)
**Font:** text-sm (14px)

### Currency Input
```tsx
<div className="flex gap-2">
  <span className="flex items-center text-muted-foreground font-semibold">AFK</span>
  <Input
    type="number"
    placeholder="0.00"
    className="flex-1 border-border text-lg font-semibold"
  />
</div>
```

**Layout:** Horizontal flex with currency prefix
**Font:** text-lg (18px) for amounts
**Flex:** flex-1 for input to take remaining space

## Responsive Enhancements

### Tablet (768px+)
```tsx
// Add larger spacing
<div className="space-y-6">

// More columns
<div className="grid grid-cols-3 md:grid-cols-4">

// Larger typography
<h1 className="text-2xl md:text-3xl">

// Wider cards
<div className="max-w-2xl mx-auto">
```

### Desktop (1025px+)
```tsx
// Full layout enhancements
<div className="mx-auto max-w-4xl px-6 py-8">

// Multi-column layouts
<div className="grid grid-cols-4 gap-6">

// Proper centering
<div className="flex items-center justify-center min-h-screen">
```

## Dark Mode Examples

### Card
```tsx
<div className="bg-white dark:bg-slate-900 text-black dark:text-white border border-gray-200 dark:border-slate-700">
```

### Icons & Badges
```tsx
<Icon className="text-blue-600 dark:text-blue-400" />
<Badge className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300" />
```

### Backgrounds
```tsx
<div className="bg-green-100 dark:bg-green-900/30">
  <span className="text-green-600 dark:text-green-400">Success</span>
</div>
```

## Animation & Transitions

### On Hover/Active
```tsx
// Button press feedback
className="active:scale-95 transition-transform"

// Color transition
className="transition-colors hover:bg-muted active:bg-muted"

// Full transition
className="transition-all"
```

### Smooth Scroll
```tsx
// Scroll behavior
<div className="overflow-y-auto smooth-scroll">
```

## Accessibility

### Color Contrast
- Text on background: ≥ 4.5:1 ratio
- Large text (18px+): ≥ 3:1 ratio
- Interactive elements: ≥ 3:1 ratio

### Touch Targets
- Minimum 44x44px (preferably 48x48px)
- Navigation buttons: 80x80px
- Adequate spacing: 8px minimum between targets

### Semantic HTML
- Use `<button>` for buttons
- Use `<a>` for links
- Use `<header>`, `<main>`, `<footer>`
- Include `aria-label` when needed

---

## Quick Copy-Paste Templates

### New Page Template
```tsx
'use client';

import { AppLayout } from '@/components/app-layout';

export default function PageName() {
  return (
    <AppLayout>
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="px-4 py-3">
          <h1 className="text-lg font-bold text-foreground">Page Title</h1>
        </div>
      </header>

      <main className="px-4 py-4 pb-24 space-y-4">
        {/* Content */}
      </main>
    </AppLayout>
  );
}
```

### Feature Card Grid
```tsx
<div className="grid grid-cols-2 gap-3">
  {features.map((feature) => (
    <Link key={feature.href} href={feature.href} className="block">
      <div className="bg-blue-100 dark:bg-blue-900/30 rounded-lg border border-border/50 p-4">
        <Icon className="w-6 h-6 text-blue-600 dark:text-blue-400 mb-2" />
        <h3 className="text-sm font-semibold text-foreground mb-0.5">{feature.title}</h3>
        <p className="text-xs text-muted-foreground">{feature.desc}</p>
      </div>
    </Link>
  ))}
</div>
```

This visual guide ensures consistency across all pages! 🎨
