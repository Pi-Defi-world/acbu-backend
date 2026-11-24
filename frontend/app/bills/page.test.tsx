import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BillsPage from './page';
import * as billsApi from '@/lib/api/bills';
import * as useBalanceHook from '@/hooks/use-balance';
import * as useApiHook from '@/hooks/use-api';

// Mock the APIs and hooks
vi.mock('@/lib/api/bills');
vi.mock('@/hooks/use-balance');
vi.mock('@/hooks/use-api');
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock environment variable
const originalEnv = process.env;
beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  
  vi.mocked(useApiHook.useApiOpts).mockReturnValue({
    token: 'test-token',
  } as any);
});

afterEach(() => {
  process.env = originalEnv;
  cleanup();
});

describe('BillsPage - Feature Flag', () => {
  it('shows coming soon message when feature flag is disabled', () => {
    process.env.NEXT_PUBLIC_BILLS_ENABLED = 'false';
    
    render(<BillsPage />);
    
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByText(/Bill payments are not yet available/)).toBeInTheDocument();
    expect(screen.queryByText('Bills & Subscriptions')).not.toBeInTheDocument();
  });

  it('shows bills UI when feature flag is enabled', () => {
    process.env.NEXT_PUBLIC_BILLS_ENABLED = 'true';
    
    vi.mocked(useBalanceHook.useBalance).mockReturnValue({
      balance: 5000,
      loading: false,
      error: '',
      refetch: vi.fn(),
    } as any);
    
    render(<BillsPage />);
    
    expect(screen.getByText('Bills & Subscriptions')).toBeInTheDocument();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
  });
});

describe('BillsPage - Real Balance Integration', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_BILLS_ENABLED = 'true';
  });

  it('displays loading state while balance is loading', () => {
    vi.mocked(useBalanceHook.useBalance).mockReturnValue({
      balance: null,
      loading: true,
      error: '',
      refetch: vi.fn(),
    } as any);
    
    render(<BillsPage />);
    
    // Should show loading skeleton
    expect(screen.getByText('Available Balance')).toBeInTheDocument();
    const loadingSkeleton = document.querySelector('.animate-pulse');
    expect(loadingSkeleton).toBeInTheDocument();
  });

  it('displays actual balance when loaded', () => {
    vi.mocked(useBalanceHook.useBalance).mockReturnValue({
      balance: 7500,
      loading: false,
      error: '',
      refetch: vi.fn(),
    } as any);
    
    render(<BillsPage />);
    
    expect(screen.getByText('ACBU 7,500')).toBeInTheDocument();
  });

  it('shows error state when balance fails to load', () => {
    vi.mocked(useBalanceHook.useBalance).mockReturnValue({
      balance: null,
      loading: false,
      error: 'Failed to load balance',
      refetch: vi.fn(),
    } as any);
    
    render(<BillsPage />);
    
    expect(screen.getByText('Failed to load balance')).toBeInTheDocument();
  });

  it('shows zero balance when balance is null but loaded', () => {
    vi.mocked(useBalanceHook.useBalance).mockReturnValue({
      balance: null,
      loading: false,
      error: '',
      refetch: vi.fn(),
    } as any);
    
    render(<BillsPage />);
    
    expect(screen.getByText('ACBU 0')).toBeInTheDocument();
  });
});

describe('BillsPage - Real Payment Integration', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_BILLS_ENABLED = 'true';
    
    vi.mocked(useBalanceHook.useBalance).mockReturnValue({
      balance: 5000,
      loading: false,
      error: '',
      refetch: vi.fn(),
    } as any);
  });

  it('calls payBill API with correct payload when payment is executed', async () => {
    const mockPayBillResponse = { transaction_reference: 'TXN_12345' };
    vi.mocked(billsApi.payBill).mockResolvedValue(mockPayBillResponse);
    
    render(<BillsPage />);
    
    // Click on electricity provider
    fireEvent.click(screen.getByText('Electricity (IKEDC/EKEDC)'));
    
    // Fill in payment details
    fireEvent.change(screen.getByPlaceholderText('Enter account or meter number'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByPlaceholderText(/Min: 10, Max: 5000/), { target: { value: '100' } });
    
    // Continue to confirmation
    fireEvent.click(screen.getByText('Continue'));
    
    // Execute payment
    fireEvent.click(screen.getByText('Pay Now'));
    
    await waitFor(() => {
      expect(billsApi.payBill).toHaveBeenCalledWith(
        {
          biller_id: 'electricity',
          amount: '100',
          reference: '1234567890',
        },
        expect.any(Object)
      );
    });
  });

  it('shows success state with transaction reference from API response', async () => {
    const mockPayBillResponse = { transaction_reference: 'TXN_ABC123' };
    vi.mocked(billsApi.payBill).mockResolvedValue(mockPayBillResponse);
    
    render(<BillsPage />);
    
    // Complete payment flow
    fireEvent.click(screen.getByText('Electricity (IKEDC/EKEDC)'));
    fireEvent.change(screen.getByPlaceholderText('Enter account or meter number'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByPlaceholderText(/Min: 10, Max: 5000/), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Pay Now'));
    
    await waitFor(() => {
      expect(screen.getByText('Payment Successful')).toBeInTheDocument();
      expect(screen.getByText('Transaction reference: TXN_ABC123')).toBeInTheDocument();
    });
  });

  it('shows generic success message when no transaction reference is returned', async () => {
    const mockPayBillResponse = { status: 'completed' }; // No transaction_reference
    vi.mocked(billsApi.payBill).mockResolvedValue(mockPayBillResponse);
    
    render(<BillsPage />);
    
    // Complete payment flow
    fireEvent.click(screen.getByText('Electricity (IKEDC/EKEDC)'));
    fireEvent.change(screen.getByPlaceholderText('Enter account or meter number'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByPlaceholderText(/Min: 10, Max: 5000/), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Pay Now'));
    
    await waitFor(() => {
      expect(screen.getByText('Payment Successful')).toBeInTheDocument();
      expect(screen.getByText('Your payment has been processed successfully.')).toBeInTheDocument();
      expect(screen.queryByText(/Transaction reference:/)).not.toBeInTheDocument();
    });
  });

  it('shows error state and prevents success when API fails', async () => {
    const mockError = new Error('Payment processing failed');
    vi.mocked(billsApi.payBill).mockRejectedValue(mockError);
    
    render(<BillsPage />);
    
    // Complete payment flow
    fireEvent.click(screen.getByText('Electricity (IKEDC/EKEDC)'));
    fireEvent.change(screen.getByPlaceholderText('Enter account or meter number'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByPlaceholderText(/Min: 10, Max: 5000/), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Pay Now'));
    
    await waitFor(() => {
      expect(screen.getByText('Payment processing failed')).toBeInTheDocument();
      expect(screen.queryByText('Payment Successful')).not.toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('prevents duplicate submissions during payment processing', async () => {
    let resolvePayment: (value: any) => void;
    const paymentPromise = new Promise((resolve) => {
      resolvePayment = resolve;
    });
    vi.mocked(billsApi.payBill).mockReturnValue(paymentPromise);
    
    render(<BillsPage />);
    
    // Complete payment flow up to Pay Now
    fireEvent.click(screen.getByText('Electricity (IKEDC/EKEDC)'));
    fireEvent.change(screen.getByPlaceholderText('Enter account or meter number'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByPlaceholderText(/Min: 10, Max: 5000/), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Continue'));
    
    // Click Pay Now
    fireEvent.click(screen.getByText('Pay Now'));
    
    // Button should show processing state and be disabled
    await waitFor(() => {
      const payButton = screen.getByRole('button', { name: /Processing.../ });
      expect(payButton).toBeDisabled();
      expect(screen.getByText('Processing...')).toBeInTheDocument();
    });
    
    // Complete the payment
    resolvePayment!({ transaction_reference: 'TXN_123' });
    
    await waitFor(() => {
      expect(screen.getByText('Payment Successful')).toBeInTheDocument();
    });
    
    // Should have been called only once despite potential double-clicks
    expect(billsApi.payBill).toHaveBeenCalledTimes(1);
  });

  it('validates insufficient balance before making API call', async () => {
    // Set balance lower than payment amount
    vi.mocked(useBalanceHook.useBalance).mockReturnValue({
      balance: 50, // Less than 100 we'll try to pay
      loading: false,
      error: '',
      refetch: vi.fn(),
    } as any);
    
    render(<BillsPage />);
    
    // Try to pay more than available balance
    fireEvent.click(screen.getByText('Electricity (IKEDC/EKEDC)'));
    fireEvent.change(screen.getByPlaceholderText('Enter account or meter number'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByPlaceholderText(/Min: 10, Max: 5000/), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Pay Now'));
    
    await waitFor(() => {
      expect(screen.getByText('Insufficient balance for this payment')).toBeInTheDocument();
      expect(billsApi.payBill).not.toHaveBeenCalled();
    });
  });

  it('validates amount within provider limits', async () => {
    render(<BillsPage />);
    
    // Try to pay below minimum amount
    fireEvent.click(screen.getByText('Electricity (IKEDC/EKEDC)'));
    fireEvent.change(screen.getByPlaceholderText('Enter account or meter number'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByPlaceholderText(/Min: 10, Max: 5000/), { target: { value: '5' } }); // Below min of 10
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Pay Now'));
    
    await waitFor(() => {
      expect(screen.getByText('Amount must be between ACBU 10 and ACBU 5000')).toBeInTheDocument();
      expect(billsApi.payBill).not.toHaveBeenCalled();
    });
  });

  it('requires reference field to be filled', async () => {
    render(<BillsPage />);
    
    fireEvent.click(screen.getByText('Electricity (IKEDC/EKEDC)'));
    fireEvent.change(screen.getByPlaceholderText(/Min: 10, Max: 5000/), { target: { value: '100' } });
    // Don't fill reference field
    
    const continueButton = screen.getByText('Continue');
    expect(continueButton).toBeDisabled();
  });
});

describe('BillsPage - Fee Display', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_BILLS_ENABLED = 'true';
    
    vi.mocked(useBalanceHook.useBalance).mockReturnValue({
      balance: 5000,
      loading: false,
      error: '',
      refetch: vi.fn(),
    } as any);
  });

  it('shows neutral fee message instead of claiming free payment', async () => {
    render(<BillsPage />);
    
    // Navigate to confirmation step
    fireEvent.click(screen.getByText('Electricity (IKEDC/EKEDC)'));
    fireEvent.change(screen.getByPlaceholderText('Enter account or meter number'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByPlaceholderText(/Min: 10, Max: 5000/), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Continue'));
    
    // Should show neutral fee message
    expect(screen.getByText('Fee:')).toBeInTheDocument();
    expect(screen.getByText('Calculated at processing')).toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
  });
});