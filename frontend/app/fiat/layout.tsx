import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Fiat On/Off-Ramp – ACBU',
  description: 'Convert between fiat currency and ACBU digital assets.',
}

export default function FiatLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
