import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocks for modules used by the page
vi.mock('@/lib/api/burn', () => ({
    burnAcbu: vi.fn(async () => ({ transaction_id: 'tx-123' })),
}));
vi.mock('@/lib/stellar/burning', () => ({
    submitBurnRedeemSingleClient: vi.fn(async () => ({ transactionHash: 'hash-abc' })),
}));

// Mock the wallets kit used by the page to avoid importing native wallet adapters
vi.mock('@/lib/stellar-wallets-kit', () => ({
    useStellarWalletsKit: () => ({
        openModal: () => ({ catch: () => { } }),
        setWallet: () => { },
        getAddress: async () => ({ address: 'DUMMY' }),
    }),
}));

// Mock stellar SDK Keypair to avoid crypto operations in test env
vi.mock('@stellar/stellar-sdk', () => ({
    Keypair: {
        fromSecret: (s: string) => ({ publicKey: () => 'GTESTPUBLICKEY12345' }),
    },
}));

const SECRET = 'SOMESECRETSEED_VALUE_XXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const PUB = 'GTESTPUBLICKEY12345';

vi.mock('@/lib/wallet-storage', () => ({
    getWalletSecretAnyLocal: vi.fn(async () => SECRET),
}));

vi.mock('@/contexts/auth-context', () => ({
    useAuth: () => ({ userId: 'user-1', stellarAddress: PUB }),
}));

vi.mock('@/hooks/use-config', () => ({
    useConfig: () => ({ config: null, loading: false, error: '', refresh: () => { } }),
}));

// Prevent next/navigation hooks from breaking in test env
vi.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams(),
}));

import { BurnPageContent } from '../page';
import * as burnApi from '@/lib/api/burn';

describe('Burn page confirmation flow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows the documented 0.3% burn fee for the entered amount', async () => {
        const { container } = render(<BurnPageContent />);
        expect(screen.getByTestId('burn-fee').textContent).toBe('0.3%');

        const amount = await screen.findByLabelText(/ACBU amount/i, {}, { container });
        fireEvent.change(amount, { target: { value: '1000' } });

        await waitFor(() => {
            expect(screen.getByTestId('burn-fee').textContent).toBe('0.3% (≈ ACBU 3)');
        });
    });

    it('does not call burn API until user confirms in the dialog', async () => {
        const { container } = render(<BurnPageContent />);

        // Fill the form
        const amount = await screen.findByLabelText(/ACBU amount/i, {}, { container });
        fireEvent.change(amount, { target: { value: '1.5' } });

        const accountNumber = screen.getByLabelText(/Account number/i);
        fireEvent.change(accountNumber, { target: { value: '1234567890' } });

        const bankCode = screen.getByLabelText(/Bank code/i);
        fireEvent.change(bankCode, { target: { value: 'BANK01' } });

        const accountName = screen.getByLabelText(/Account name/i);
        fireEvent.change(accountName, { target: { value: 'Alice Example' } });

        // Submit the form — should open confirmation dialog, but not call API yet
        const formEl = container.querySelector('form');
        expect(formEl).toBeTruthy();
        fireEvent.submit(formEl!);

        // Confirmation dialog should appear
        const confirmTitle = await screen.findByText(/Confirm burn and withdraw/i);
        expect(confirmTitle).toBeTruthy();

        // burn API should not have been called yet
        expect((burnApi as any).burnAcbu).not.toHaveBeenCalled();

        // Click confirm
        const confirmBtn = screen.getByRole('button', { name: /Confirm and Burn/i });
        fireEvent.click(confirmBtn);

        // Now burn API should be called
        await waitFor(() => {
            expect((burnApi as any).burnAcbu).toHaveBeenCalled();
        });

        // And transaction submitted message should appear
        const submitted = await screen.findAllByText(/Transaction submitted/i);
        expect(submitted.length).toBeGreaterThan(0);
    });
});
