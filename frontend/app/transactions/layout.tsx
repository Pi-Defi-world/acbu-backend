import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Transaction – ACBU',
  description: 'View details for this ACBU transaction.',
}

export default function TransactionsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
