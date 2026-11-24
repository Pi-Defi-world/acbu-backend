import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Activity – ACBU',
  description: 'Browse your full transaction history and activity feed.',
}

export default function ActivityLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
