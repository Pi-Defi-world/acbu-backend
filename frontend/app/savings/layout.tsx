import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Savings – ACBU',
  description: 'Grow your funds with ACBU savings — deposit, withdraw, and track earnings.',
}

export default function SavingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
