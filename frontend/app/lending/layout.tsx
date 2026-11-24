import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Lending – ACBU',
  description: 'Access ACBU lending products — borrow or lend digital assets.',
}

export default function LendingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
