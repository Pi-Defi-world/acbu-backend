import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Settings – ACBU',
  description: 'Configure your ACBU account: security, wallet, contacts, and more.',
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
