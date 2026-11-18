# Mobile-First Implementation Checklist

Use this checklist when updating or creating any page in the ACBU app.

## Page Structure Checklist

### Layout Foundation
- [ ] Page uses `AppLayout` wrapper component
- [ ] Main content uses `px-4 py-4 pb-24` padding
- [ ] No `mx-auto max-w-md` containers on mobile
- [ ] Content respects bottom navigation space (pb-24)

### Typography
- [ ] Headers are `text-base` or `text-lg` maximum
- [ ] Body text uses `text-sm` (14px)
- [ ] Meta/secondary text uses `text-xs` (12px)
- [ ] All font sizes tested on 375px width
- [ ] Text color contrast meets WCAG AA standards

### Spacing
- [ ] Vertical spacing uses `space-y-4` or `space-y-5`
- [ ] Grid gaps use `gap-3` (12px) on mobile
- [ ] Section spacing consistent throughout
- [ ] No spacing larger than `space-y-6` on mobile
- [ ] Padding consistent: `p-3`, `p-4`, `p-5`

### Cards & Containers
- [ ] Cards use `rounded-lg border border-border bg-card p-3` minimum
- [ ] Cards are full-width on mobile
- [ ] No fixed widths that break responsiveness
- [ ] Proper border and background styling
- [ ] Active/hover states use `active:bg-muted`

### Text Overflow Handling
- [ ] Long text items use `truncate` class
- [ ] Text containers use `min-w-0` for flex children
- [ ] Multi-line text limited appropriately
- [ ] No text overflow outside containers
- [ ] Flex items use proper `flex-1` and `flex-shrink-0`

### Interactive Elements
- [ ] All buttons minimum 40px height
- [ ] Touch targets minimum 44x44px (Tap target)
- [ ] Icons are `w-4 h-4`, `w-5 h-5`, or `w-6 h-6`
- [ ] Buttons have active states with `active:scale-95`
- [ ] Links are underlined or clearly interactive

### Navigation
- [ ] Header is sticky with proper z-index
- [ ] Tab navigation uses proper button styling
- [ ] Bottom navigation always visible
- [ ] Navigation items are 80px tall (h-20)
- [ ] All routes properly mapped

### Forms & Inputs
- [ ] Input fields have `p-3` padding minimum
- [ ] Labels visible and properly associated
- [ ] Currency symbols placed correctly (AFK only)
- [ ] Form fields responsive and mobile-friendly
- [ ] Submit buttons full-width on mobile

### Lists & Data Display
- [ ] List items have proper flex layout
- [ ] Icons left-aligned in lists
- [ ] Content area uses `flex-1 min-w-0`
- [ ] Action area right-aligned with `flex-shrink-0`
- [ ] Status badges properly sized (`text-xs`)

### Modals & Dialogs
- [ ] Bottom sheets used instead of centered dialogs
- [ ] Proper z-index stacking (z-50)
- [ ] Modals slide up from bottom on mobile
- [ ] Close buttons always accessible
- [ ] Backdrop properly darkens page

### Colors & Theming
- [ ] Primary color used for main actions
- [ ] Accent color for secondary actions
- [ ] Destructive color for dangerous actions
- [ ] Dark mode variants included (`dark:` classes)
- [ ] Proper color contrast in both modes

## Content Checklist

### Balance & Amount Display
- [ ] All amounts use "AFK X.XX" format
- [ ] No USD or Stellar references
- [ ] Balance visibility toggle present where needed
- [ ] Large font for important amounts

### Activity Lists
- [ ] Icon + description + date on top line
- [ ] Amount and status on bottom line
- [ ] Proper layout with flex and `pl-11` for indent
- [ ] Status badges small but readable
- [ ] Hover/active states clear

### Feature Cards
- [ ] Icon clearly visible
- [ ] Title and description present
- [ ] No overflow of text
- [ ] Touch-friendly sizing
- [ ] Consistent with design system

### Buttons & Actions
- [ ] Primary action: solid blue/primary
- [ ] Secondary action: outline style
- [ ] Destructive action: red styling
- [ ] CTA buttons full-width on mobile
- [ ] Icon buttons properly sized

## Responsive Behavior

### Mobile (320px - 767px)
- [ ] 1-2 column layouts
- [ ] No horizontal scrolling
- [ ] Full-width inputs and buttons
- [ ] Stacked sections
- [ ] Readable at 375px minimum

### Tablet (768px - 1024px)
- [ ] Optional 3-4 column layouts
- [ ] Slightly larger spacing
- [ ] Cards may be wider
- [ ] Side-by-side layouts possible

### Desktop (1025px+)
- [ ] Max-width containers added
- [ ] Multiple column layouts
- [ ] Enhanced spacing
- [ ] Centered content

## Performance & Accessibility

- [ ] No unoptimized images
- [ ] Images have alt text
- [ ] Proper semantic HTML
- [ ] ARIA labels where needed
- [ ] Keyboard navigation supported
- [ ] Touch gestures responsive
- [ ] No layout shifts on load
- [ ] Console clear of warnings

## Dark Mode Testing

- [ ] All text readable in dark mode
- [ ] Icons visible in dark mode
- [ ] Background colors appropriate
- [ ] Borders visible in dark mode
- [ ] Gradients look good in dark mode
- [ ] Status indicators clear in dark mode

## Mobile Device Testing

Test on actual or simulated devices:
- [ ] iPhone SE (375x667)
- [ ] iPhone 12/13/14 (390x844)
- [ ] Pixel 6 (412x915)
- [ ] iPad Mini (768x1024)
- [ ] Test in both portrait and landscape

## Before Deployment

- [ ] No console errors
- [ ] All routes working
- [ ] Navigation fully functional
- [ ] No content overflow
- [ ] Touch-friendly on mobile
- [ ] Fast on slow 4G
- [ ] Accessible (a11y check)
- [ ] WCAG 2.1 AA compliant

## Quick Reference

### Page Template
```tsx
export default function PageName() {
  return (
    <AppLayout>
      {/* Header - sticky top */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="px-4 py-3">
          <h1 className="text-lg font-bold text-foreground">Page Title</h1>
        </div>
      </header>

      {/* Main Content - full width with padding */}
      <main className="px-4 py-4 pb-24 space-y-4">
        {/* Content here */}
      </main>
    </AppLayout>
  );
}
```

### Common Components

**Card:**
```tsx
<div className="rounded-lg border border-border bg-card p-3 active:bg-muted transition-colors">
```

**Button:**
```tsx
<Button className="w-full h-auto px-4 py-3">Action</Button>
```

**List Item:**
```tsx
<div className="flex items-center gap-3">
  <Icon className="w-5 h-5 flex-shrink-0" />
  <div className="flex-1 min-w-0">
    <p className="truncate text-sm">Title</p>
  </div>
  <div className="flex-shrink-0">Action</div>
</div>
```

**Grid:**
```tsx
<div className="grid grid-cols-2 gap-3">
  {/* 2 columns on mobile, responsive */}
</div>
```

---

**Remember:** Mobile-first means designing for 375px width first, then enhancing for larger screens. Test frequently on actual mobile devices!
