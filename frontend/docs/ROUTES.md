# ACBU Fintech App - Route Navigation Guide

## Primary Navigation (Bottom 5-Tab Navigation)

### 1. `/` - Home Dashboard
**Icon:** Home  
**Purpose:** Main dashboard with balance overview and quick actions

**Content:**
- Current balance display
- Quick action grid (Send, Mint, Business, Savings, Lending)
- Recent activity/transaction feed
- Feature highlights

---

### 2. `/send/*` - Send & Transfer Hub
**Icon:** Send  
**Purpose:** All money transfer operations

**Sub-routes:**
- **`/send`** - P2P Transfer (Main)
  - Send money between wallets
  - Frequent recipients
  - Transaction history
  - Inline navigation: P2P | Mint/Burn | International | History

- **`/send/international`** - International Transfers
  - Send money across borders
  - Multi-currency support
  - Real-time exchange rates
  - Delivery tracking

- **`/send/history`** - Full transaction history
  - Detailed transaction view
  - Filters and search
  - Transaction receipts

---

### 3. `/mint/*` - Mint & Burn Hub
**Icon:** Coins (Zap/Lightning)  
**Purpose:** Create and redeem AFK currency

**Sub-routes:**
- **`/mint`** - Main Mint/Burn page
  - Mint tab: Convert to AFK
  - Burn tab: Redeem AFK for fiat
  - Rates tab: Exchange rate information
  - Fee display and confirmation flows

---

### 4. `/business/*` - Business Services Hub
**Icon:** Briefcase  
**Purpose:** Complete business solutions suite

**Sub-routes:**
- **`/business`** - Business Hub (Main)
  - SME Services: Business accounts, transfers
  - Payroll: Employee salary disbursement
  - Enterprise: Bulk operations, treasury
  - Payment Gateway: Charge creation, escrow

- **`/business/sme`** - SME Services
  - Business account management
  - Transfers for SMEs
  - Business statements

- **`/business/salary`** - Payroll Management
  - Schedule salary disbursements
  - Create salary batches
  - Payroll history

- **`/business/enterprise`** - Enterprise Features
  - Bulk transfers
  - Treasury management
  - Reconciliation tools

- **`/business/gateway`** - Payment Gateway
  - Create payment charges
  - Manage escrow
  - Release/refund operations

---

### 5. `/me/*` - User Account Hub
**Icon:** User  
**Purpose:** Personal account, settings, and security

**Sub-routes:**
- **`/me`** - Account Overview (Main)
  - Profile summary
  - Account balance
  - Menu to all account features

- **`/me/profile`** - User Profile
  - Edit personal information
  - Profile picture
  - Account status
  - Delete account option

- **`/me/settings`** - Account Settings
  - Receive address & QR code
  - Wallet confirmation
  - Contact management
  - Guardian settings
  - Notification preferences

- **`/me/kyc`** - KYC Verification
  - Start KYC application
  - View verification status
  - Upload/manage documents
  - Verification history

- **`/me/recovery`** - Account Recovery
  - Recovery methods (Email, SMS, Guardian)
  - Password reset
  - Account unlock
  - 2FA backup codes

- **`/me/wallet`** - Wallet Management
  - Stellar wallet details
  - Receive address
  - QR code display
  - Wallet verification

- **`/me/activity`** - Activity History
  - Account activity log
  - Login history
  - Device management
  - Security events

- **`/me/2fa`** - Two-Factor Authentication
  - Enable/disable 2FA
  - Set up authenticator
  - SMS/Email verification
  - Backup codes

---

## Secondary Routes (Not in Main Navigation)

### Authentication Routes
- **`/auth/signin`** - Sign In
  - Email/password authentication
  - Remember me option
  - Forgot password link

- **`/auth/2fa`** - Two-Factor Authentication
  - 6-digit code entry
  - Backup code option
  - Resend code

---

### Standalone Pages
- **`/savings`** - Savings Accounts
  - High-yield savings
  - Savings goals
  - Interest tracking
  - Deposit/withdraw

- **`/lending`** - Lending Products
  - Loan applications
  - Active loans
  - Repayment tracking
  - Interest calculation

- **`/bills`** - Bill Payments
  - Utilities (electricity, water)
  - Mobile airtime
  - Internet & services
  - Payment history

---

## Route Architecture Principles

### Hierarchical Grouping
- Related features are grouped under parent routes
- Example: All account operations under `/me`
- Example: All business tools under `/business`
- Example: All sending methods under `/send`

### Navigation Tabs Within Pages
Pages like `/send` and `/mint` include internal navigation tabs to related features:
- **Send page tabs:** P2P | Mint/Burn | International | History
- **Mint page tabs:** Mint | Burn | Rates
- **Business page:** Inline service cards for quick access

### Flat Alternative Routes
Some pages are accessible directly for simplicity:
- `/savings` - Direct access from home quick actions
- `/lending` - Direct access from home quick actions
- `/bills` - Direct access from home quick actions

---

## URL Pattern Examples

```
Primary Navigation:
/                      # Home dashboard
/send                  # Main send page
/mint                  # Main mint/burn page
/business              # Business hub
/me                    # Account overview

Send Sub-routes:
/send                  # P2P transfers
/send/international    # International transfers
/send/history          # Transfer history

Business Sub-routes:
/business/sme          # SME services
/business/salary       # Payroll
/business/enterprise   # Enterprise tools
/business/gateway      # Payment gateway

Account Sub-routes:
/me/profile            # User profile
/me/settings           # Account settings
/me/kyc                # KYC verification
/me/recovery           # Account recovery
/me/wallet             # Wallet management

Auth Routes:
/auth/signin           # Sign in page
/auth/2fa              # 2FA verification

Standalone:
/savings               # Savings accounts
/lending               # Lending products
/bills                 # Bill payments
```

---

## Mobile Navigation Bar Items

```
┌─────────────────────────────────────────┐
│  🏠        ✈️        ⚡       💼       👤  │
│ Home      Send      Mint    Business   Me  │
└─────────────────────────────────────────┘
```

Each tab is always accessible, enabling fast navigation between major sections.

---

## Accessibility & UX Considerations

- **Breadcrumb**: Use back button on headers for secondary pages
- **Active State**: Current route shown in nav with primary color
- **Bottom Padding**: All pages respect 80px bottom padding for nav visibility
- **Sticky Headers**: Important headers (balance, title) are sticky
- **Quick Actions**: Links to related pages in header nav bars
- **Consistent Styling**: All pages follow ACBU design system
