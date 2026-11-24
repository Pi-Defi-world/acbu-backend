import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Reserves – ACBU',
  description: 'View ACBU reserve holdings and proof-of-reserves data.',
}

export default function ReservesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
