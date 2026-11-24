import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SecurityPage from './page';
import { useAuth } from '@/contexts/auth-context';
import * as userApi from '@/lib/api/user';

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  replace: vi.fn(),
  deleteMe: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/api/user', () => ({
  deleteMe: mocks.deleteMe,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

describe('SecurityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ logout: mocks.logout } as ReturnType<typeof useAuth>);
  });

  it('does not present unsupported session, API-key, or 2FA controls', () => {
    render(<SecurityPage />);

    expect(screen.getByText(/No security changes are made from this page/)).toBeInTheDocument();
    expect(screen.queryByText('Active Sessions')).not.toBeInTheDocument();
    expect(screen.queryByText('API Keys')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rotate Device|Create API key|Revoke/ })).not.toBeInTheDocument();
  });

  it('confirms and deletes the account, logs out, and redirects to sign-in', async () => {
    mocks.deleteMe.mockResolvedValue(undefined);
    mocks.logout.mockResolvedValue(undefined);

    render(<SecurityPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));

    await waitFor(() => {
      expect(userApi.deleteMe).toHaveBeenCalledOnce();
      expect(mocks.logout).toHaveBeenCalledOnce();
      expect(mocks.replace).toHaveBeenCalledWith('/auth/signin');
    });
  });

  it('keeps the account and shows an error if deletion fails', async () => {
    mocks.deleteMe.mockRejectedValue(new Error('Deletion failed'));

    render(<SecurityPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deletion' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Deletion failed');
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});