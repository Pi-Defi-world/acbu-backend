# Focus Trap Implementation - Summary

## Issue
Dialog components may not trap focus within the modal. When keyboard-only users tab past the last focusable element, focus moves to the background page instead of wrapping back to the first focusable element within the modal. This breaks keyboard navigation accessibility.

## Solution
Implemented a custom `useFocusTrap` React hook that manages focus trapping for dialog/modal components. This hook:

1. **Identifies focusable elements** within a container (buttons, links, inputs, selects, textareas, and elements with tabindex)
2. **Traps Tab navigation** - When Tab is pressed on the last focusable element, focus wraps to the first element
3. **Traps Shift+Tab navigation** - When Shift+Tab is pressed on the first element, focus wraps to the last element
4. **Filters accessibility-compliant elements** - Ignores disabled and hidden elements
5. **Restores previous focus** - When the trap is deactivated, returns focus to the previously focused element

## Files Created/Modified

### Created
- [hooks/use-focus-trap.ts](hooks/use-focus-trap.ts) - Custom focus trap hook
- [hooks/__tests__/use-focus-trap.test.ts](hooks/__tests__/use-focus-trap.test.ts) - Comprehensive test suite (6 tests, all passing)

### Modified
- [components/ui/dialog.tsx](components/ui/dialog.tsx) - Added focus trap to DialogContent
- [components/ui/alert-dialog.tsx](components/ui/alert-dialog.tsx) - Added focus trap to AlertDialogContent
- [components/ui/sheet.tsx](components/ui/sheet.tsx) - Added focus trap to SheetContent
- [components/ui/drawer.tsx](components/ui/drawer.tsx) - Added focus trap to DrawerContent

## Implementation Details

### useFocusTrap Hook

```typescript
useFocusTrap(containerRef, { isActive?: boolean, onFocusChange?: (element: HTMLElement) => void })
```

**Parameters:**
- `containerRef` - React ref pointing to the modal/dialog container element
- `options.isActive` - Whether focus trap should be active (default: true)
- `options.onFocusChange` - Callback when focus moves to a new element

**Features:**
- Automatically finds all focusable elements within the container
- Prevents focus from escaping the modal via Tab/Shift+Tab navigation
- Restores previous focus when deactivated
- Properly handles edge cases (no focusable elements, dynamic DOM changes)

### Component Integration

Each dialog component (Dialog, AlertDialog, Sheet, Drawer) now:
1. Creates a ref to the content element
2. Calls `useFocusTrap(contentRef, { isActive: true })` in the component
3. Passes the ref to the Radix UI/Vaul primitive via `ref={contentRef}`

Example:
```tsx
function DialogContent({ className, children, ...props }) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  useFocusTrap(contentRef, { isActive: true })

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={contentRef}
        className={cn(...)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}
```

## Test Coverage

All 6 tests passing:
✓ Traps focus on Tab from last element to first
✓ Traps focus on Shift+Tab from first element to last
✓ Does not trap focus when inactive
✓ Finds various focusable element types
✓ Ignores disabled elements
✓ Ignores hidden elements

## Accessibility Improvements

This fix addresses:
- **WCAG 2.1 Success Criterion 2.1.2 (Level A)** - Keyboard accessible
- **WCAG 2.1 Success Criterion 2.4.3 (Level A)** - Focus order logical
- **APG: Dialog (Modal) Pattern** - Focus management

Keyboard-only users can now:
- Tab through all interactive elements within a modal
- Use Shift+Tab to navigate backwards
- Cannot accidentally focus elements outside the modal while it's open
- Have focus returned to the trigger element when the modal closes
