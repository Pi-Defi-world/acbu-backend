import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Business – ACBU',
  description: 'ACBU business accounts and SME financial tools.',
}

export default function BusinessLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
