import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LendingPage from './page'
import * as userApi from '@/lib/api/user'
import * as lendingApi from '@/lib/api/lending'
import * as useApiHook from '@/hooks/use-api'
import * as i18nContext from '@/contexts/i18n-context'

// Mock the APIs and hooks
vi.mock('@/lib/api/user')
vi.mock('@/lib/api/lending')
vi.mock('@/hooks/use-api')
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))
vi.mock('@/lib/lending-store', () => ({
  listApplications: vi.fn(() => []),
  saveApplication: vi.fn((app) => [app]),
}))
vi.mock('@/contexts/i18n-context', () => ({
  useI18n: () => ({
    t: (key: string, params?: any) => {
      if (key === 'lending.title') return 'Lending'
      if (key === 'lending.position') return 'Lender Balance'
      if (key === 'lending.sign_in_to_view') return 'Sign in to view balance'
      if (key === 'lending.lender') return `Lender: ${params?.user}`
      if (key === 'lending.lender_unavailable') return 'Lender info not available'
      return key
    },
  }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('LendingPage - Loading States', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    vi.mocked(useApiHook.useApiOpts).mockReturnValue({
      token: 'test-token',
    } as any)
  })

  it('shows skeleton loading state while fetching lending balance', async () => {
    vi.mocked(userApi.getReceive).mockResolvedValue({
      pay_uri: 'test@stellar',
      alias: undefined,
    } as any)

    // Mock getLendingBalance with a delayed response to keep loading state visible
    const delayedPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ balance: 5000 })
      }, 100)
    })
    vi.mocked(lendingApi.getLendingBalance).mockReturnValue(delayedPromise as any)

    render(<LendingPage />)

    await screen.findByText('Lending')

    // Should eventually show the balance once loading completes
    await waitFor(() => {
      expect(screen.getByText('ACBU 5,000')).toBeInTheDocument()
    })
  })

  it('displays balance once data fetch completes', async () => {
    vi.mocked(userApi.getReceive).mockResolvedValue({
      pay_uri: 'test@stellar',
      alias: undefined,
    } as any)

    vi.mocked(lendingApi.getLendingBalance).mockResolvedValue({
      balance: 7500,
    } as any)

    render(<LendingPage />)

    await waitFor(() => {
      expect(screen.getByText('ACBU 7,500')).toBeInTheDocument()
    })
  })

  it('shows error message with proper accessibility attributes on fetch failure', async () => {
    vi.mocked(userApi.getReceive).mockResolvedValue({
      pay_uri: 'test@stellar',
      alias: undefined,
    } as any)

    vi.mocked(lendingApi.getLendingBalance).mockRejectedValue(
      new Error('Failed to load lending balance')
    )

    render(<LendingPage />)

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert).toBeInTheDocument()
      expect(alert).toHaveAttribute('aria-live', 'assertive')
      expect(alert).toHaveAttribute('aria-atomic', 'true')
      expect(alert).toHaveTextContent('Failed to load lending balance')
    })
  })

  it('clears loading state on error (does not leave spinner stuck)', async () => {
    vi.mocked(userApi.getReceive).mockResolvedValue({
      pay_uri: 'test@stellar',
      alias: undefined,
    } as any)

    vi.mocked(lendingApi.getLendingBalance).mockRejectedValue(
      new Error('Connection failed')
    )

    render(<LendingPage />)

    await waitFor(() => {
      // The error should be displayed, not a stuck spinner
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByText('Connection failed')).toBeInTheDocument()
    })
  })

  it('handles missing user info gracefully during loading', async () => {
    vi.mocked(userApi.getReceive).mockResolvedValue({
      pay_uri: undefined,
      alias: undefined,
    } as any)

    render(<LendingPage />)

    await waitFor(() => {
      expect(screen.getByText('Sign in to view balance')).toBeInTheDocument()
    })
  })

  it('displays lender identifier when available', async () => {
    vi.mocked(userApi.getReceive).mockResolvedValue({
      pay_uri: 'lender@stellar.org',
      alias: undefined,
    } as any)

    vi.mocked(lendingApi.getLendingBalance).mockResolvedValue({
      balance: 10000,
    } as any)

    render(<LendingPage />)

    await waitFor(() => {
      expect(screen.getByText(/Lender: lender@stellar/)).toBeInTheDocument()
      expect(screen.getByText('ACBU 10,000')).toBeInTheDocument()
    })
  })

  it('shows error state before balance loads', async () => {
    vi.mocked(userApi.getReceive).mockResolvedValue({
      pay_uri: 'test@stellar',
      alias: undefined,
    } as any)

    // Simulate error immediately
    vi.mocked(lendingApi.getLendingBalance).mockRejectedValue(
      new Error('Service unavailable')
    )

    render(<LendingPage />)

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('Service unavailable')
      // Should not show any balance while errored
      expect(screen.queryByText(/ACBU \d+/)).not.toBeInTheDocument()
    })
  })
})
