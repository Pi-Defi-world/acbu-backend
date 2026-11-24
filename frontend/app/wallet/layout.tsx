import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Wallet – ACBU',
  description: 'Manage your ACBU wallet, view balances, and access wallet settings.',
}

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
