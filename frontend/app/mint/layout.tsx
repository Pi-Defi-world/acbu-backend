import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Mint – ACBU',
  description: 'Mint new ACBU tokens (admin operation).',
}

export default function MintLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
