import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Account Recovery – ACBU',
  description: 'Recover access to your ACBU account using your recovery phrase or guardians.',
}

export default function RecoveryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
