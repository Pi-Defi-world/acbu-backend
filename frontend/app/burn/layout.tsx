import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Burn – ACBU',
  description: 'Burn ACBU tokens to reduce supply (admin operation).',
}

export default function BurnLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
