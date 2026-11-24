import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Bills – ACBU',
  description: 'Pay utility bills, airtime, and other services directly from your ACBU wallet.',
}

export default function BillsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
