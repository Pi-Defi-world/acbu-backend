# Mobile-First Design Guide - ACBU App

## Overview
This app is built mobile-first with a 100% responsive design that feels like a native mobile application across all devices.

## Core Principles

### 1. Container & Padding Strategy
```tsx
// CORRECT - Mobile-first approach
<main className="px-4 py-4 pb-24">
  {/* Content */}
</main>

// INCORRECT - Max-width container first
<main className="mx-auto max-w-md p-4 pb-24">
  {/* This breaks mobile UX */}
</main>
```

Key points:
- Use `px-4` for mobile horizontal padding (16px)
- Use `py-4` for vertical padding (16px)
- Always add `pb-24` to account for fixed bottom navigation (96px), and drop it
  with `md:pb-0` once the desktop sidebar takes over
- Never use `mx-auto max-w-md` on mobile - reserve for desktop enhancements

### 2. Spacing & Gaps
```tsx
// CORRECT - Consistent mobile spacing
<div className="space-y-4">
  {/* 16px gap between items */}
</div>

// CORRECT - Flexible grid gaps
<div className="grid grid-cols-2 gap-3">
  {/* 12px gap on mobile, scales responsively */}
</div>

// AVOID
<div className="space-y-6">
  {/* Too large for mobile screens */}
</div>
```

### 3. Text Truncation & Overflow
```tsx
// CORRECT - Prevent text overflow
<div className="min-w-0">
  {/* Container allows child to truncate */}
  <p className="truncate text-sm">Long text here</p>
</div>

// CORRECT - Multi-line with limit
<p className="text-sm font-medium text-foreground truncate">
  Sent to Kwame Asante
</p>

// INCORRECT - Text overflows container
<div className="flex items-center">
  <p className="text-sm">Very long text that overflows</p>
</div>
```

### 4. Flexbox for Lists & Items
```tsx
// CORRECT - Responsive flex items
<div className="flex items-center gap-3">
  <div className="flex-shrink-0">Icon</div>
  <div className="flex-1 min-w-0">Truncated content</div>
  <div className="flex-shrink-0">Action</div>
</div>

// CORRECT - Activity items
{mockRecentTransactions.map((transaction) => (
  <div key={transaction.id} className="rounded-lg border border-border bg-card p-3">
    <div className="flex items-center gap-3 mb-2">
      <Icon />
      <div className="flex-1 min-w-0">
        <p className="truncate">Description</p>
        <p className="text-xs text-muted-foreground">Date</p>
      </div>
    </div>
    <div className="flex items-center justify-between pl-11">
      <p>Amount</p>
      <Badge>Status</Badge>
    </div>
  </div>
))}
```

### 5. Card & Container Styling
```tsx
// CORRECT - Mobile card sizing
<div className="rounded-lg border border-border bg-card p-3 transition-colors active:bg-muted">
  {/* Compact mobile-sized card */}
</div>

// CORRECT - Larger cards for emphasis
<div className="rounded-lg border border-border bg-gradient-to-br from-primary to-secondary p-5 text-primary-foreground">
  {/* Prominent card */}
</div>

// MOBILE FONT SIZES
- Headers: text-lg (18px), text-base (16px)
- Body: text-sm (14px)
- Meta: text-xs (12px)
- Never use text-2xl or larger without responsive handling
```

### 6. Input & Form Handling
```tsx
// CORRECT - Mobile-friendly inputs
<div className="flex gap-2">
  <span className="flex items-center text-muted-foreground">AFK</span>
  <Input
    type="number"
    placeholder="0.00"
    className="border-border text-lg font-semibold flex-1"
  />
</div>

// Touch-friendly button sizing
<Button className="h-auto px-4 py-3">
  Send AFK 100
</Button>
```

### 7. Navigation & Touch Targets
```tsx
// CORRECT - Mobile nav height
<nav className="fixed bottom-0 left-0 right-0 border-t border-border bg-card z-40 md:hidden">
  <div className="flex justify-between items-center h-20 px-1">
    {/* 80px nav height = comfortable touch targets */}
  </div>
</nav>

// CORRECT - Button touch sizing
<button className="h-20 flex flex-col items-center justify-center gap-1">
  {/* Touch-friendly 80px tall */}
</button>

// Bottom padding for nav overlay (mobile only)
<main className="pb-24 md:pb-0">
  {/* 96px padding = nav height (80px) + margin, dropped on desktop */}
</main>
```

### 7b. Desktop Layout (md and up)
```tsx
// CORRECT - Sidebar is hidden on mobile, shown from md upwards
<nav className="hidden md:flex md:sticky md:top-0 md:h-screen md:w-64 flex-col border-r">
  {/* Same destinations as the mobile tab bar */}
</nav>

// CORRECT - The page content sits next to the sidebar
<div className="flex min-h-screen">
  <DesktopSidebar />
  <div className="flex min-w-0 flex-1 flex-col">{children}</div>
</div>
```

Both navigations read their destinations from
`/components/navigation/nav-items.ts`, so the tab bar and the sidebar can
never drift apart. Breakpoints are handled with CSS (`md:hidden` /
`hidden md:flex`) instead of JavaScript, which keeps the first paint free of
layout shifts.

### 8. Dialog & Modal Handling
```tsx
// CORRECT - Bottom sheet style (mobile-first)
{showLogoutConfirm && (
  <div className="fixed inset-0 z-50 flex items-end bg-black/50">
    <div className="w-full bg-card p-6 rounded-t-xl border-t border-border">
      {/* Sheet slides up from bottom */}
    </div>
  </div>
)}

// NOT CENTERED - Mobile screens too small
<div className="fixed inset-0 z-50 flex items-center justify-center">
  {/* Center dialogs only on larger screens */}
</div>
```

### 9. Responsive Columns
```tsx
// CORRECT - 2 columns on mobile
<div className="grid grid-cols-2 gap-3">
  {/* Scales perfectly on mobile */}
</div>

// UPGRADE for tablet+
<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
  {/* Responsive upgrade */}
</div>

// AVOID on mobile
<div className="grid grid-cols-4 gap-4">
  {/* Too cramped on mobile */}
</div>
```

### 10. Icons & Images
```tsx
// CORRECT - Icon sizing
- Navigation: w-5 h-5 (20px)
- List items: w-4 h-4 (16px)
- Large cards: w-6 h-6 (24px)
- Small indicators: w-3 h-3 (12px)

// CORRECT - Avatar sizing
<div className="w-14 h-14 rounded-full">
  {/* 56px avatar for profile header */}
</div>

<div className="w-9 h-9 rounded-full">
  {/* 36px avatar for list items */}
</div>
```

### 11. Dark Mode Awareness
```tsx
// CORRECT - Color classes with dark variants
<div className="bg-green-100 dark:bg-green-900/30">
  {/* Light and dark background */}
</div>

<Icon className="text-green-600 dark:text-green-400">
  {/* Readable in both modes */}
</Icon>

// Badge styling
<Badge className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
  Completed
</Badge>
```

### 12. Common Pitfalls to Avoid

❌ **DON'T:**
```tsx
// Using max-width containers on mobile
<main className="mx-auto max-w-md p-4">

// Large spacing on mobile
<div className="space-y-8">

// Horizontal scrolling content
<div className="overflow-x-auto">

// Non-touch-friendly buttons
<button className="p-1 text-xs">

// Overflowing text in cards
<p>Very long text that overflows the container</p>

// Fixed widths breaking responsiveness
<div className="w-96 p-4">

// Too many grid columns on mobile
<div className="grid grid-cols-4">

// Center dialogs on small screens
<div className="flex items-center justify-center">
```

✅ **DO:**
```tsx
// Direct padding and full-width on mobile
<main className="px-4 py-4 pb-24">

// Moderate spacing appropriate for mobile
<div className="space-y-4">

// Vertical scrolling only
<div className="overflow-y-auto">

// Touch-friendly targets
<button className="p-3 text-sm">

// Text with truncation handling
<p className="truncate text-sm">Short text</p>

// Flexible layouts
<div className="w-full p-4">

// Responsive columns
<div className="grid grid-cols-2 md:grid-cols-4">

// Bottom sheets for mobile modals
<div className="flex items-end">
```

## Testing Checklist

- [ ] All text is readable without zooming
- [ ] All buttons are at least 44px tall for touch
- [ ] No horizontal scrolling required
- [ ] No content overflow outside containers
- [ ] Proper spacing between interactive elements
- [ ] Navigation is always accessible (bottom nav)
- [ ] Forms are easy to fill on mobile
- [ ] Images and icons are properly sized
- [ ] Dark mode works correctly
- [ ] Content looks good at 320px, 375px, 425px widths

## Device Testing Dimensions

- iPhone SE: 375x667px
- iPhone 12/13/14: 390x844px
- Pixel 6: 412x915px
- iPad Mini: 768x1024px
- iPad Pro: 1024x1366px

Always test at 375px minimum width for mobile!
