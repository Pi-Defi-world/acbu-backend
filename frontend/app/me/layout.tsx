import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'My Account – ACBU',
  description: 'Manage your ACBU profile, settings, and account preferences.',
}

export default function MeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
