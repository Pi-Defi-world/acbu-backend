'use client'

import { useEffect, useRef } from 'react'

/**
 * Gets all focusable elements within a container
 * Includes buttons, links, inputs, selects, textareas, and elements with tabindex
 */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  if (!container) return []

  const selector = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ')

  return Array.from(container.querySelectorAll(selector)).filter((element) => {
    const style = window.getComputedStyle(element as HTMLElement)
    return style.display !== 'none' && style.visibility !== 'hidden'
  }) as HTMLElement[]
}

interface UseFocusTrapOptions {
  /**
   * Whether the focus trap should be active
   * @default true
   */
  isActive?: boolean
  /**
   * Called when focus trap is about to move focus
   */
  onFocusChange?: (element: HTMLElement) => void
}

/**
 * Hook that traps focus within a container element
 * Ensures Tab and Shift+Tab wrap focus within the container
 * Useful for modals, dialogs, and other overlay components
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  options?: UseFocusTrapOptions,
) {
  const { isActive = true, onFocusChange } = options || {}
  const previousActiveElementRef = useRef<HTMLElement | null>(null)

  // Store the previously focused element for restoration when trap unmounts
  useEffect(() => {
    if (!isActive || !containerRef.current) return

    previousActiveElementRef.current =
      (document.activeElement as HTMLElement) || document.body
  }, [isActive, containerRef])

  // Set up focus trap
  useEffect(() => {
    if (!isActive || !containerRef.current) return

    const container = containerRef.current
    const focusableElements = getFocusableElements(container)

    if (focusableElements.length === 0) return

    const firstElement = focusableElements[0]!
    const lastElement = focusableElements[focusableElements.length - 1]!

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return

      const activeElement = document.activeElement as HTMLElement

      // Tab key pressed
      if (!event.shiftKey) {
        if (activeElement === lastElement || !container.contains(activeElement)) {
          event.preventDefault()
          firstElement.focus()
          onFocusChange?.(firstElement)
        }
      }
      // Shift+Tab key pressed
      else {
        if (
          activeElement === firstElement ||
          !container.contains(activeElement)
        ) {
          event.preventDefault()
          lastElement.focus()
          onFocusChange?.(lastElement)
        }
      }
    }

    // Set initial focus to first focusable element if no element in container is focused
    if (!container.contains(document.activeElement as HTMLElement)) {
      firstElement.focus()
      onFocusChange?.(firstElement)
    }

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActive, containerRef, onFocusChange])

  // Restore focus when trap is deactivated or unmounts
  useEffect(() => {
    return () => {
      if (!isActive && previousActiveElementRef.current) {
        try {
          previousActiveElementRef.current.focus()
        } catch {
          // Element might not be focusable anymore
        }
      }
    }
  }, [isActive])
}
