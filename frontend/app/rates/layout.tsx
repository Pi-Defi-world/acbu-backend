import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Exchange Rates – ACBU',
  description: 'Live exchange rates for ACBU-supported currencies.',
}

export default function RatesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
