import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsPage from './page';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    'aria-label'?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('SettingsPage navigation', () => {
  it('renders each settings destination as a semantic link', () => {
    render(<SettingsPage />);

    const destinations = [
      ['/me/settings/receive', 'Go to Receive settings - Address & QR'],
      ['/wallet', 'Go to Wallet settings - Manage wallet'],
      ['/me/settings/contacts', 'Go to Contacts settings - Manage contacts'],
      ['/me/settings/guardians', 'Go to Guardians settings - Recovery guardians'],
      ['/me/settings/security', 'Go to Security settings - 2FA & delete account'],
    ];

    for (const [href, name] of destinations) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});