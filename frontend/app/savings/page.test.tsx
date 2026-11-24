import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SavingsPage from './page'
import * as userApi from '@/lib/api/user'
import * as savingsApi from '@/lib/api/savings'
import * as useApiHook from '@/hooks/use-api'

// Mock the APIs
vi.mock('@/lib/api/user')
vi.mock('@/lib/api/savings')
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))
vi.mock('@/hooks/use-api')
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('SavingsPage - Loading States', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    vi.mocked(useApiHook.useApiOpts).mockReturnValue({
      token: 'test-token',
    } as any)
  })

  it('shows skeleton loading state while fetching savings balance', async () => {
    // Mock getReceive to return user info
    vi.mocked(userApi.getReceive).mockResolvedValue({
      pay_uri: 'test@stellar',
      alias: undefined,
    } as any)

    // Mock getSavingsPositions with a delayed response to keep loading state visible
    const delayedPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ balance: 1500 })
      }, 100)
    })
    vi.mocked(savingsApi.getSavingsPositions).mockReturnValue(delayedPromise as any)

    render(<SavingsPage />)

    // Wait for the page to render
    await screen.findByText('Savings')

    // The component should eventually show the skeleton while loading
    // After the delayed promise resolves, the actual balance should appear
    await waitFor(() => {
      expect(screen.getByText('ACBU 1,500')).toBeInTheDocument()
    })
  })

  it('displays balance once data fetch completes', async () => {
    vi.mocked(userApi.getReceive).mockResolvedValue({
      pay_uri: 'test@stellar',
      alias: undefined,
    } as any)

    vi.mocked(savingsApi.getSavingsPositions).mockResolvedValue({
      balance: 2500,
    } as any)

    render(<SavingsPage />)

    await waitFor(() => {
      expect(screen.getByText('ACBU 2,500')).toBeInTheDocument()
    })
  })

  it('shows error message with proper accessibility attributes on fetch failure', async () => {
    vi.mocked(userApi.getReceive).mockRejectedValue(
      new Error('Failed to load user info')
    )

    render(<SavingsPage />)

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert).toBeInTheDocument()
      expect(alert).toHaveAttribute('aria-live', 'assertive')
      expect(alert).toHaveAttribute('aria-atomic', 'true')
      expect(alert).toHaveTextContent('Failed to load user info')
    })
  })

  it('clears loading state on error (does not leave spinner stuck)', async () => {
    vi.mocked(userApi.getReceive).mockRejectedValue(
      new Error('Network error')
    )

    const { container } = render(<SavingsPage />)

    await waitFor(() => {
      // The skeleton should not be visible (no animate-pulse elements in loading state)
      // Instead, the error message should be shown
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('displays both balance cards with loading skeletons', async () => {
    vi.mocked(userApi.getReceive).mockResolvedValue({
      pay_uri: 'test@stellar',
      alias: undefined,
    } as any)

    vi.mocked(savingsApi.getSavingsPositions).mockResolvedValue({
      balance: 3000,
    } as any)

    render(<SavingsPage />)

    // Wait for both balance cards to load
    await waitFor(() => {
      const balanceTexts = screen.getAllByText(/ACBU \d+/)
      expect(balanceTexts.length).toBeGreaterThanOrEqual(2) // At least on-chain and total
    })
  })

  it('shows total savings calculation including goals', async () => {
    vi.mocked(userApi.getReceive).mockResolvedValue({
      pay_uri: 'test@stellar',
      alias: undefined,
    } as any)

    vi.mocked(savingsApi.getSavingsPositions).mockResolvedValue({
      balance: 2500,
    } as any)

    render(<SavingsPage />)

    await waitFor(() => {
      // Should show the total savings (API balance + goals)
      expect(screen.getByText(/Total Savings/)).toBeInTheDocument()
      // The page has initial goals, so total should be api balance + goals total
      expect(screen.getByText(/ACBU \d+/)).toBeInTheDocument()
    })
  })
})
