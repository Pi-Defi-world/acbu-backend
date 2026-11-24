import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'Send Money – ACBU',
  description: 'Send money instantly to any ACBU user or external wallet.',
}

export default function SendLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
