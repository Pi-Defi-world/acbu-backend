# ACBU Fintech Application

A modern, mobile-first fintech application built with Next.js 16 and React 19, featuring a comprehensive suite of financial services built exclusively around the native ACBU (AFK) currency.

## 🎯 Quick Start

The application uses a **responsive navigation** system for primary feature access — a bottom tab bar on mobile and a sidebar from the `md` breakpoint upwards:

```
┌─ Home       ─ Dashboard & overview
├─ Send       ─ P2P transfers, international, history
├─ Mint       ─ Create/redeem AFK currency
├─ Business   ─ SME, payroll, enterprise tools
├─ Wallet     ─ Wallet balance and details
└─ Me         ─ Account, settings, security
```

## 📁 Directory Structure

```
app/
├── page.tsx                 # Home dashboard
├── send/
│   └── page.tsx            # P2P transfers (main)
│   └── international/      # International transfers
│   └── history/            # Transfer history
├── mint/
│   └── page.tsx            # Mint/Burn hub
├── business/
│   ├── page.tsx            # Business hub
│   ├── sme/                # SME services
│   ├── salary/             # Payroll management
│   ├── enterprise/         # Enterprise features
│   └── gateway/            # Payment gateway
├── me/
│   ├── page.tsx            # Account overview
│   ├── profile/            # User profile
│   ├── settings/           # Account settings
│   ├── kyc/                # KYC verification
│   ├── recovery/           # Account recovery
│   ├── wallet/             # Wallet management
│   ├── activity/           # Activity history
│   └── 2fa/                # Two-factor auth
├── savings/                # Savings accounts
├── lending/                # Lending products
├── bills/                  # Bill payments
└── auth/
    ├── signin/             # Sign in
    └── 2fa/                # 2FA verification

components/
├── mobile-nav.tsx          # Bottom navigation (mobile only)
├── desktop-sidebar.tsx     # Sidebar navigation (desktop only)
├── navigation/nav-items.ts # Shared navigation destinations
├── app-layout.tsx          # Main layout wrapper
└── ui/                     # shadcn/ui components

docs/
├── ARCHITECTURE.md         # Detailed architecture
├── ROUTES.md              # Complete routing guide
└── README.md              # This file
```
- **USSD_SMS_CHANNEL.md** - Proposed USSD/SMS fallback channel for feature phones and low connectivity

## 🎨 Design System

### Colors
- **Primary**: Purple/Indigo (`oklch(0.35 0.12 280)`)
- **Accent**: Teal/Cyan (`oklch(0.55 0.15 160)`)
- **Neutrals**: Grayscale (white, grays, black)
- **Currency**: AFK only (no USD, Stellar, or external references)

### Typography
- **Headings**: Use font-sans for consistency
- **Body**: Consistent 14px+ font sizes
- **Line Height**: 1.4-1.6 for readability

### Layout
- **Mobile-First**: Optimized for mobile devices
- **Flexbox**: Primary layout method
- **Max Width**: 28rem (md breakpoint) for content
- **Bottom Padding**: 24 (96px) for mobile nav visibility

## 💰 Currency System

The application uses **AFK (ACBU)** as the only currency:
- All balances displayed in AFK
- All transactions in AFK
- ACBU processing fees displayed in AFK
- Stellar network fees are paid in XLM (stroops), separately from ACBU fees
- Stellar network for blockchain operations
- No USD, USDC, or external currency conversions

### Key Numbers
- 1 AFK = 1 unit of native ACBU
- Stellar network fees: not free; the backend's configured fallback base fee is 100 stroops, while dynamic fees and payment surge buffering can increase the transaction fee
- Soroban transactions can include resource fees; ledger-entry rent or minimum-balance reserves may also apply depending on the operation
- ACBU processing fees: variable by operation and reserve conditions; see the [backend fee policy](https://github.com/Pi-Defi-world/acbu-backend/blob/dev/src/services/feePolicy/feePolicyService.ts)
- Exchange displayed in rates tabs (informational only)

The backend resolves Stellar base and payment fees in its [Stellar fee manager](https://github.com/Pi-Defi-world/acbu-backend/blob/dev/src/services/stellar/feeManager.ts). Network fees are separate from ACBU processing fees; minimum-balance reserves are locked funds, not network fees.

## 🔐 Security & Authentication

### Current Implementation
- Mock authentication (ready for integration)
- Placeholder user data
- 2FA flow structure ready
- KYC verification workflow

### Production Ready
- Input validation on all forms
- Error handling for API operations
- Secure session management pattern
- Ready for API.acbu.io integration

## 🚀 Features

### Core Features
- **P2P Transfers**: Send money between wallets with frequent recipient management
- **Mint/Burn**: Create and redeem AFK currency
- **Business Services**: Complete suite for SME, payroll, and enterprise
- **Account Management**: Profile, settings, KYC, recovery
- **Savings & Lending**: Interest-bearing accounts and loan products
- **Bill Payments**: Utilities, airtime, and services

### In-Page Navigation
Features are grouped logically with internal navigation:
- Send page includes tabs for P2P, Mint/Burn, International, History
- Mint page includes tabs for Mint, Burn, Rates
- Business page includes cards for all business services

## 📱 Mobile Experience

### Navigation
- **5-item bottom tab bar**: Persistent across all pages
- **Active state**: Current route highlighted in primary color
- **Touch-friendly**: Large tap targets (56px minimum)
- **Icon + Label**: Clear identification

### Responsive
- **Mobile-first design**: Optimized for 375px-430px width
- **Max width**: 28rem for content containers
- **Proper spacing**: Consistent 16px padding
- **Safe area**: Bottom padding for iOS notch support

## 🔗 API Integration

### Ready for Integration
All pages include mock data structures ready for real API calls:

```
Base URL: https://api.acbu.io

Key Endpoints (to be implemented):
POST   /send              # Create transfer
GET    /send/history      # Get transfers
POST   /mint              # Mint operation
POST   /burn              # Burn operation
GET    /account           # User account
GET    /business          # Business services
POST   /kyc/start         # Start KYC
GET    /bills/catalog     # Bill catalog
POST   /bills/pay         # Pay bill
```

## 🛠 Development

### Technologies
- **Framework**: Next.js 16 with App Router
- **UI Library**: React 19 with shadcn/ui
- **Styling**: Tailwind CSS v4
- **Icons**: Lucide React
- **State**: React hooks (SWR ready)

6. **Offline access**: Add a USSD/SMS fallback channel for feature phones and low-connectivity users (see `docs/USSD_SMS_CHANNEL.md`)

### Key Files to Know
- `/components/navigation/nav-items.ts` - Navigation configuration
- `/components/mobile-nav.tsx` - Bottom navigation (mobile only)
- `/components/desktop-sidebar.tsx` - Sidebar navigation (desktop only)
- `/components/app-layout.tsx` - Layout wrapper
- `/app/globals.css` - Design tokens and theme
- `/docs/ROUTES.md` - Complete routing reference
- `/docs/ARCHITECTURE.md` - Architecture details

## 📚 Documentation

- **ARCHITECTURE.md** - System design and principles
- **ROUTES.md** - Complete routing guide with examples
- **README.md** - This file

## 🎯 Next Steps

1. **API Integration**: Connect to api.acbu.io endpoints
2. **Authentication**: Replace mock auth with real implementation
3. **Database**: Set up transaction and user data persistence
4. **Testing**: Add unit and integration tests
5. **Deployment**: Deploy to Vercel with environment variables

## 📝 Notes

- **Currency**: All USD references have been removed; AFK is the only currency
- **Navigation**: New mobile nav with 5 primary tabs (Home, Send, Mint, Business, Me)
- **Structure**: Organized architecture makes it easy to add new features
- **Scalability**: Each section is modular and can grow independently
- **Accessibility**: WCAG 2.1 compliant with semantic HTML
