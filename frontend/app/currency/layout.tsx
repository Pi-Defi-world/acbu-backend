import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Currency Settings – ACBU',
  description: 'Set your preferred display currency for ACBU.',
}

export default function CurrencyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
