import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MintPage from './page'
import * as authContext from '@/contexts/auth-context'
import * as useBalanceHook from '@/hooks/use-balance'
import * as useApiHook from '@/hooks/use-api'
import * as useFiatAccountsHook from '@/hooks/use-fiat-accounts'
import * as ratesApi from '@/lib/api/rates'
import * as fiatApi from '@/lib/api/fiat'

// Mock the hooks and APIs
vi.mock('@/contexts/auth-context')
vi.mock('@/hooks/use-balance')
vi.mock('@/hooks/use-api')
vi.mock('@/hooks/use-fiat-accounts')
vi.mock('@/lib/api/rates')
vi.mock('@/lib/api/fiat')
vi.mock('@/lib/stellar-wallets-kit', () => ({
  useStellarWalletsKit: () => ({
    openModal: vi.fn(),
  }),
}))
// eslint-disable-next-line @typescript-eslint/no-require-imports
const React = require('react');
vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children, value, onValueChange }: { children: React.ReactNode, value: string, onValueChange: (v: string) => void }) => {
    return (
      <div data-testid="tabs">
        {React.Children.map(children, (child: unknown) => {
          if (React.isValidElement(child)) {
            return React.cloneElement(child as React.ReactElement, { activeValue: value, onValueChange });
          }
          return child;
        })}
      </div>
    );
  },
  TabsList: ({ children, activeValue, onValueChange }: { children: React.ReactNode, activeValue?: string, onValueChange?: (v: string) => void }) => (
    <div role="tablist">
      {React.Children.map(children, (child: unknown) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement, { activeValue, onValueChange });
        }
        return child;
      })}
    </div>
  ),
  TabsTrigger: ({ children, value, onValueChange }: { children: React.ReactNode, value: string, onValueChange?: (v: string) => void }) => (
    <button role="tab" onClick={() => onValueChange?.(value)}>
      {children}
    </button>
  ),
  TabsContent: ({ children, value }: { children: React.ReactNode, value: string }) => (
    <div role="tabpanel" data-testid={`tabs-content-${value}`}>
      {children}
    </div>
  ),
}))
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode, open: boolean }) => open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => <button onClick={onClick}>{children}</button>,
  AlertDialogCancel: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => <button onClick={onClick}>{children}</button>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({}),
  usePathname: () => '/',
}))

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('MintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
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
      balanceSource: 'stellar',
      loading: false,
      refetch: vi.fn(),
      error: '',
    })

    vi.mocked(useApiHook.useApiOpts).mockReturnValue({
    })

    vi.mocked(useFiatAccountsHook.useFiatAccounts).mockReturnValue({
      accounts: [{ id: 'acc1', currency: 'NGN', bank_name: 'Test Bank', balance: '0', account_number: '0000000000', account_name: 'Test', ledger_entries: [] }],
      loading: false,
      error: '',
      refetch: vi.fn(),
      refresh: vi.fn(),
    })

    vi.mocked(ratesApi.getRates).mockResolvedValue({ acbu_usd: '1.0' })
    vi.mocked(fiatApi.getFiatAccounts).mockResolvedValue({ accounts: [{ id: 'acc1', currency: 'NGN', bank_name: 'Test Bank', balance: '0', account_number: '0000000000', account_name: 'Test', ledger_entries: [] }] })
  })

  it('renders the mint page', async () => {
    render(<MintPage />)
    expect(await screen.findByText('Mint & Burn')).toBeInTheDocument()
    expect(screen.getByText('Mint ACBU')).toBeInTheDocument()
  })

  it('calculates estimated ACBU when fiat amount is entered', async () => {
    render(<MintPage />)
    await screen.findByText('Mint & Burn')
    
    const amountInput = screen.getByLabelText('Amount to Exchange')
    fireEvent.change(amountInput, { target: { value: '10' } })
    
    // Match the estimated ACBU section specifically
    expect(await screen.findByText(/Estimated ACBU/i)).toBeInTheDocument()
    expect(await screen.findByText(/≈ 10/)).toBeInTheDocument()
  })

  it('switches to Burn tab and validates balance', async () => {
    render(<MintPage />)
    await screen.findByText('Mint & Burn')
    
    const burnTab = screen.getByRole('tab', { name: /Burn/i })
    fireEvent.click(burnTab)
    
    const burnAmountInput = screen.getByLabelText('Amount to Burn')
    fireEvent.change(burnAmountInput, { target: { value: '50' } })
    
    // Use getAllByText and check that at least one match is correct or use a more specific matcher
    const availableTexts = screen.getAllByText(/100/)
    expect(availableTexts.length).toBeGreaterThan(0)
    expect(screen.getByText(/Available: ACBU/)).toBeInTheDocument()
    expect(screen.getByText('Continue to Burn & Redeem')).not.toBeDisabled()
  })
})
