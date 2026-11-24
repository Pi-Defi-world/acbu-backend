import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Sign In – ACBU',
  description: 'Sign in or create your ACBU account to get started.',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
