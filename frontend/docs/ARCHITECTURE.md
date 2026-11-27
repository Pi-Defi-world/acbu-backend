# ACBU Fintech App Architecture

## Overview
A mobile-first fintech application built with Next.js 16, featuring native ACBU (AFK) currency operations and comprehensive financial services.

## Core Principles
- **Mobile-First Design**: Optimized for mobile with touch-friendly interfaces
- **Feature Grouping**: Related features are grouped under parent routes for better navigation
- **Native Currency**: All operations use ACBU (AFK) - no USD or external currency dependencies
- **Clear Navigation**: 5-item mobile navigation for primary features
- **Modular Structure**: Pages and components organized by feature domain

## Navigation Architecture

### Mobile Navigation (Bottom Tab Bar)
```
Home    → Dashboard & quick actions
Send    → P2P transfers, international, reserves
Mint    → Mint/Burn operations, rates
Business → SME, Salary, Enterprise features
Me      → Profile, settings, KYC, recovery
```

### Route Structure

#### `/` - Home (Dashboard)
- Main dashboard with balance overview
- Quick action tiles
- Recent activity feed
- Feature shortcuts

#### `/send/*` - Send & Transfer Features
- `/send` - P2P transfers (primary)
  - `/send/mint` - Mint operations
  - `/send/burn` - Burn operations
  - `/send/international` - International transfers
  - `/send/reserves` - Reserves & rates
  - `/send/history` - Transaction history

#### `/mint/*` - Currency Operations
- `/mint` - Mint/Burn hub
  - `/mint/from-usdc` - Mint from USDC (legacy)
  - `/mint/rates` - Exchange rates
  - `/mint/quote` - Get quotes
  - `/mint/history` - Transaction history

#### `/business/*` - Business Services
- `/business` - Business hub
  - `/business/sme` - Small business services
  - `/business/salary` - Payroll
  - `/business/enterprise` - Bulk operations
  - `/business/gateway` - Payment processing
  - `/business/escrow` - Escrow management

#### `/me/*` - User Account & Settings
- `/me` - Account overview
  - `/me/profile` - User profile
  - `/me/settings` - Settings hub
  - `/me/kyc` - KYC verification
  - `/me/recovery` - Account recovery
  - `/me/wallet` - Wallet management

#### Other Top-Level Features
- `/bills` - Bill payments
- `/savings` - Savings accounts
- `/lending` - Lending products
- `/auth/signin` - Sign in
- `/auth/2fa` - Two-factor authentication

## Data Models

### Core Types
```typescript
// Currency - only ACBU
type Currency = 'AFK';

// Transaction
interface Transaction {
  id: string;
  type: 'send' | 'receive' | 'mint' | 'burn';
  amount: number;
  currency: 'AFK';
  status: 'pending' | 'completed' | 'failed';
  timestamp: Date;
}

// User
interface User {
  id: string;
  email: string;
  name: string;
  walletAddress: string;
  kycStatus: 'pending' | 'approved' | 'rejected';
}
```

## Component Organization

### Shared Components
- `/components/mobile-nav.tsx` - Bottom navigation (mobile only, `md:hidden`)
- `/components/desktop-sidebar.tsx` - Sidebar navigation (desktop only, `hidden md:flex`)
- `/components/navigation/nav-items.ts` - Shared destination list for both navigations
- `/components/app-layout.tsx` - App wrapper
- `/components/ui/*` - shadcn/ui components

### Page Components
- Organized by route hierarchy
- Self-contained with local state
- Import shared components as needed

## Styling Guidelines

### Color System
- **Primary**: Purple/Indigo (oklch(0.35 0.12 280))
- **Accent**: Teal/Cyan (oklch(0.55 0.15 160))
- **Neutrals**: Grayscale tokens
- See `/app/globals.css` for complete theme

### Layout
- Mobile-first responsive design
- Flexbox for primary layouts
- Consistent spacing with Tailwind scale
- Semantic HTML structure

## API Integration

### Endpoints
All API calls target `api.acbu.io`:
- POST `/send` - Create transfer
- POST `/mint` - Mint operation
- POST `/burn` - Burn operation
- GET `/account` - User account
- etc.

### Error Handling
- Proper error states for all operations
- User-friendly error messages
- Retry mechanisms for transient failures

## Performance & Caching

### Data Fetching
- Use SWR for client-side data synchronization
- Leverage Next.js API routes for server operations
- Cache transaction history where appropriate

### Bundle Optimization
- Code-split by route
- Lazy load non-critical features
- Optimize images and assets

## Security

### Best Practices
- No sensitive data in localStorage
- Secure session management
- Input validation on all forms
- Rate limiting on API calls
- XSS/CSRF protection
