# Architecture Restructuring & Currency Migration

## Overview
This document outlines the major restructuring of the ACBU fintech application, including:
1. Navigation redesign (5-tab system)
2. Route reorganization (hierarchical grouping)
3. Currency standardization (AFK-only)
4. Proper architectural framework

## Changes Made

### 1. Navigation Restructure

#### Before
- Home, Send, SME, Save, Borrow (5 unrelated tabs)

#### After
```
Home     → Dashboard
Send     → P2P + International transfers
Mint     → Mint/Burn currency operations
Business → SME + Payroll + Enterprise + Gateway
Me       → Profile + Settings + KYC + Recovery
```

#### Implementation
- **File**: `/components/mobile-nav.tsx`
- **New Icons**: Home, Send, Coins (Zap), Briefcase, User
- **Updated Navigation**: All links to restructured routes

### 2. Route Reorganization

#### New Hierarchy
```
PRIMARY ROUTES (Mobile Nav)
├── /                 → Home Dashboard
├── /send/*           → Send Hub
│   ├── /send         → P2P Transfers (default)
│   ├── /send/international
│   └── /send/history
├── /mint/*           → Mint/Burn Hub
│   └── /mint         → Combined Mint/Burn page
├── /business/*       → Business Hub
│   ├── /business     → Services overview
│   ├── /business/sme
│   ├── /business/salary
│   ├── /business/enterprise
│   └── /business/gateway
├── /me/*             → Account Hub
│   ├── /me           → Overview
│   ├── /me/profile
│   ├── /me/settings
│   ├── /me/kyc
│   ├── /me/recovery
│   ├── /me/wallet
│   ├── /me/activity
│   └── /me/2fa

SECONDARY ROUTES (Direct Access)
├── /savings          → Savings products
├── /lending          → Lending products
├── /bills            → Bill payments
└── /auth/*           → Authentication
    ├── /auth/signin
    └── /auth/2fa
```

#### Key Improvements
- **Logical Grouping**: Related features under parent routes
- **Clearer Navigation**: Users understand where to find features
- **Scalability**: Easy to add new sub-features
- **Accessibility**: Back buttons and breadcrumbs on secondary pages

### 3. Currency Standardization - AFK Only

#### USD/Stellar References Removed From
✅ `/app/p2p/page.tsx` - Replaced $ with AFK, removed Stellar mentions
✅ `/app/send/page.tsx` - NEW: AFK-only implementation
✅ `/app/mint/page.tsx` - NEW: Native currency operations only
✅ `/app/savings/page.tsx` - All balances in AFK
✅ `/app/lending/page.tsx` - All loan amounts in AFK
✅ `/app/currency/page.tsx` - Kept for reference (plan: deprecate)
✅ `/app/page.tsx` - Dashboard updated for AFK
✅ `/app/bills/page.tsx` - Updated to AFK
✅ `/app/account/page.tsx` - Account features in AFK
✅ `/app/account/profile/page.tsx` - Profile in AFK

#### Specific Changes
```
OLD: "USD • Stellar Wallet"
NEW: "Native ACBU Currency"

OLD: "$1,200.50"
NEW: "AFK 1,200.50"

OLD: "$USD"
NEW: "AFK"

OLD: Currency selector with USD, EUR, GBP, XLM
NEW: AFK-only (rates display informational only)
```

### 4. New Files Created

#### Pages
- ✅ `/app/send/page.tsx` - P2P transfers with integrated navigation
- ✅ `/app/mint/page.tsx` - Mint/Burn operations
- ✅ `/app/business/page.tsx` - Business services hub
- ✅ `/app/me/page.tsx` - User account hub

#### Documentation
- ✅ `/docs/ARCHITECTURE.md` - Complete system design
- ✅ `/docs/ROUTES.md` - Detailed routing guide
- ✅ `/docs/README.md` - Quick reference
- ✅ `/docs/MIGRATION.md` - This file

### 5. Component Updates

#### Mobile Navigation
**File**: `/components/mobile-nav.tsx`
- Updated nav items: Home, Send, Mint, Business, Me
- Improved styling with 5-item layout
- Proper active state indicators
- z-50 for proper stacking

#### App Layout
**File**: `/components/app-layout.tsx`
- Added flexbox structure for proper spacing
- Bottom padding increased to `pb-24` (96px)
- Flexible layout for future enhancements

### 6. In-Page Navigation Features

#### Send Page
- **Tabs**: P2P | Mint/Burn | International | History
- **Purpose**: Quick access to related transfer features
- **Quick buttons** to mint/burn operations

#### Mint Page
- **Tabs**: Mint | Burn | Rates
- **Purpose**: All currency operations in one place
- **Real-time rates** for informational purposes

#### Business Page
- **Card navigation** to services
- **Quick links** to settings and API
- **Service grid** layout for easy discovery

## Migration Checklist

### ✅ Completed
- [x] Updated mobile navigation (5 tabs)
- [x] Restructured route hierarchy
- [x] Removed all USD references
- [x] Removed Stellar-specific mentions
- [x] Updated all currency displays to AFK
- [x] Created new send/page.tsx
- [x] Created new mint/page.tsx
- [x] Created business/page.tsx
- [x] Created me/page.tsx
- [x] Updated app layout for proper spacing
- [x] Created comprehensive documentation

### ⏳ Ready for Implementation
- [ ] API integration (api.acbu.io)
- [ ] Real authentication
- [ ] Database schema setup
- [ ] User data persistence
- [ ] Transaction history storage
- [ ] KYC document storage
- [ ] Error handling refinement
- [ ] Rate limiting
- [ ] Analytics tracking

### 🔄 Legacy Files (Planned Deprecation)
- `/app/p2p/page.tsx` → Use `/app/send/page.tsx` instead
- `/app/currency/page.tsx` → Use `/app/mint/page.tsx` instead
- `/app/account/page.tsx` → Use `/app/me/page.tsx` instead

## Design Tokens (No Changes)

### Color System
- **Primary**: `oklch(0.35 0.12 280)` - Purple/Indigo
- **Accent**: `oklch(0.55 0.15 160)` - Teal/Cyan
- **Neutrals**: Grayscale (no changes)
- No color changes needed; currency values are text-based

### Typography
- No changes; font sizes and weights remain consistent
- All ACBU text displayed clearly with AFK symbol

## Testing Checklist

### Navigation
- [ ] All 5 nav buttons accessible
- [ ] Active state shows correctly
- [ ] Back buttons work on secondary pages
- [ ] No broken links

### Currency Display
- [ ] All amounts show AFK prefix
- [ ] No USD symbols visible
- [ ] Decimal formatting consistent
- [ ] Rates page shows AFK/other conversions (informational only)

### Pages
- [ ] Send page loads with tabs
- [ ] Mint page shows mint/burn operations
- [ ] Business page shows all services
- [ ] Me page shows account options
- [ ] Bottom nav visible on all pages

## Future Enhancements

1. **Advanced Filtering**
   - Transaction filters by date, type, amount
   - Business analytics dashboard

2. **Enhanced Security**
   - Biometric authentication
   - Enhanced 2FA options
   - Hardware wallet support

3. **Internationalization**
   - Multi-language support
   - Regional customization
   - Localized formatting

4. **Advanced Features**
   - Scheduled payments
   - Payment templates
   - Batch operations
   - API webhooks

## Rollback Plan

If issues arise, previous implementations are available:
- `/app/p2p/page.tsx` - Original P2P transfers
- `/app/currency/page.tsx` - Original mint/burn
- `/app/account/page.tsx` - Original account page

All previous versions maintain the same AFK currency standard.
