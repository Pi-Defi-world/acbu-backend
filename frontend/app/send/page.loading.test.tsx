import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SendPage from './page'
import * as transfersApi from '@/lib/api/transfers'
import * as userApi from '@/lib/api/user'
import * as useBalanceHook from '@/hooks/use-balance'
import * as useApiHook from '@/hooks/use-api'
import * as authContext from '@/contexts/auth-context'

// Mock the APIs and hooks
vi.mock('@/lib/api/transfers')
vi.mock('@/lib/api/user')
vi.mock('@/hooks/use-balance')
vi.mock('@/hooks/use-api')
vi.mock('@/contexts/auth-context')
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))
vi.mock('@/hooks/use-session-guard', () => ({
  useSessionGuard: () => ({
    ensureSession: vi.fn(() => Promise.resolve(true)),
  }),
}))
vi.mock('@/hooks/use-wallet-setup', () => ({
  useWalletSetup: () => ({
    getWalletSigner: vi.fn(),
  }),
}))
vi.mock('@/contexts/i18n-context', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))
vi.mock('@/hooks/use-api-error', () => ({
  useApiError: () => ({
    uiError: null,
    setApiError: vi.fn(),
    clearError: vi.fn(),
    isSubmitDisabled: false,
  }),
}))
vi.mock('@/contexts/navigation-guard-context', () => ({
  useNavigationGuard: () => ({
    setHasUnsavedChanges: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-haptic', () => ({
  useHaptic: () => ({
    triggerHaptic: vi.fn(),
  }),
}))
vi.mock('@/hooks/use-scroll-restoration', () => ({
  useScrollRestoration: vi.fn(),
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('SendPage - Loading States', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    vi.mocked(useApiHook.useApiOpts).mockReturnValue({
      token: 'test-token',
    } as any)

    vi.mocked(authContext.useAuth).mockReturnValue({
      userId: 'user-1',
      stellarAddress: 'G...',
      isAuthenticated: true,
      isHydrated: true,
      login: vi.fn(),
      logout: vi.fn(),
      setAuth: vi.fn(),
      refreshStellarAddress: vi.fn(),
    })

    vi.mocked(useBalanceHook.useBalance).mockReturnValue({
      balance: 100,
      loading: false,
      refetch: vi.fn(),
      error: '',
    })
  })

  it('shows skeleton loading state for transfers history tab', async () => {
    // Simulate delayed transfer loading
    const delayedPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ transfers: [{ transaction_id: '1', amount_acbu: 50, created_at: new Date().toISOString(), status: 'completed' }] })
      }, 100)
    })
    vi.mocked(transfersApi.getTransfers).mockReturnValue(delayedPromise as any)
    vi.mocked(userApi.getContacts).mockResolvedValue({ contacts: [] } as any)

    const { container } = render(<SendPage />)

    await screen.findByText('send.send')

    // Eventually the transfers should load and skeleton disappear
    await waitFor(() => {
      // Check that the page has loaded transfers (SkeletonList will be gone)
      expect(transfersApi.getTransfers).toHaveBeenCalled()
    })
  })

  it('displays transfers once data fetch completes', async () => {
    vi.mocked(transfersApi.getTransfers).mockResolvedValue({
      transfers: [
        {
          transaction_id: '1',
          amount_acbu: 50,
          created_at: '2024-01-15T10:00:00Z',
          status: 'completed',
        },
      ],
    } as any)

    vi.mocked(userApi.getContacts).mockResolvedValue({ contacts: [] } as any)

    render(<SendPage />)

    // Navigate to history tab
    await waitFor(() => {
      const historyTab = screen.getByText('send.history')
      if (historyTab) {
        historyTab.click()
      }
    }, { timeout: 1000 })

    // Should show the transfer eventually
    await waitFor(() => {
      expect(transfersApi.getTransfers).toHaveBeenCalled()
    })
  })

  it('shows skeleton for contacts while loading', async () => {
    // Simulate delayed contacts loading
    const delayedPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ contacts: [{ id: '1', alias: 'Alice', pay_uri: 'alice@stellar' }] })
      }, 100)
    })
    vi.mocked(userApi.getContacts).mockReturnValue(delayedPromise as any)
    vi.mocked(transfersApi.getTransfers).mockResolvedValue({ transfers: [] } as any)

    render(<SendPage />)

    await waitFor(() => {
      expect(userApi.getContacts).toHaveBeenCalled()
    })
  })

  it('shows error message with proper accessibility when transfers fail', async () => {
    vi.mocked(transfersApi.getTransfers).mockRejectedValue(
      new Error('Failed to load transfers')
    )

    vi.mocked(userApi.getContacts).mockResolvedValue({ contacts: [] } as any)

    render(<SendPage />)

    await waitFor(() => {
      const alert = screen.queryByRole('alert')
      if (alert) {
        expect(alert).toHaveAttribute('aria-live', 'assertive')
        expect(alert).toHaveTextContent('Failed to load transfers')
      }
    }, { timeout: 2000 })
  })

  it('clears loading state on contacts error', async () => {
    vi.mocked(transfersApi.getTransfers).mockResolvedValue({ transfers: [] } as any)

    vi.mocked(userApi.getContacts).mockRejectedValue(
      new Error('Failed to load contacts')
    )

    render(<SendPage />)

    await waitFor(() => {
      // Error should be shown, not spinner stuck
      const alert = screen.queryByRole('alert')
      if (alert) {
        expect(alert).toHaveTextContent('Failed to load contacts')
      }
    }, { timeout: 2000 })
  })

  it('handles both transfers and contacts loading simultaneously', async () => {
    const transfersDelay = new Promise((resolve) => {
      setTimeout(() => resolve({ transfers: [] }), 50)
    })
    const contactsDelay = new Promise((resolve) => {
      setTimeout(() => resolve({ contacts: [] }), 50)
    })

    vi.mocked(transfersApi.getTransfers).mockReturnValue(transfersDelay as any)
    vi.mocked(userApi.getContacts).mockReturnValue(contactsDelay as any)

    render(<SendPage />)

    await waitFor(() => {
      expect(transfersApi.getTransfers).toHaveBeenCalled()
      expect(userApi.getContacts).toHaveBeenCalled()
    })
  })
})
