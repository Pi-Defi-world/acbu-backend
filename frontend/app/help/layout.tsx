import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Help & Support – ACBU',
  description: 'Find answers, contact support, and browse ACBU help resources.',
}

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
