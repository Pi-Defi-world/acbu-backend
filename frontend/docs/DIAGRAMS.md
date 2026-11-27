# ACBU App Architecture Diagrams

## 1. Mobile Navigation Structure

```
┌─────────────────────────────────────────────────────┐
│                  ACBU FINTECH APP                   │
└─────────────────────────────────────────────────────┘
                      ↓
            ┌─────────────────────┐
            │   App Content Area  │
            │                     │
            │   Dynamic Pages     │
            │   Based on Route    │
            │                     │
            └─────────────────────┘
                      ↓
    ┌──────────┬──────────┬──────────┬──────────┬──────────┐
    │   🏠     │    ✈️    │    ⚡    │   💼    │    👤    │
    │  Home    │   Send   │  Mint    │Business │    Me    │
    │   /      │  /send   │  /mint   │/business│   /me    │
    └──────────┴──────────┴──────────┴──────────┴──────────┘
           Primary Navigation Bar (Always Visible)
```

## 2. Route Hierarchy

```
ROOT (/)
│
├─ / (Home Dashboard)
│  ├─ Quick action grid
│  ├─ Balance display
│  └─ Recent activity
│
├─ /send/* (Send Hub)
│  ├─ /send (P2P Transfers)
│  │  ├─ Tab: P2P
│  │  ├─ Tab: Mint/Burn (link)
│  │  ├─ Tab: International
│  │  └─ Tab: History
│  ├─ /send/international
│  └─ /send/history
│
├─ /mint/* (Currency Hub)
│  └─ /mint (Mint/Burn)
│     ├─ Tab: Mint
│     ├─ Tab: Burn
│     └─ Tab: Rates
│
├─ /business/* (Business Hub)
│  ├─ /business (Overview)
│  │  ├─ Card: SME Services
│  │  ├─ Card: Payroll
│  │  ├─ Card: Enterprise
│  │  └─ Card: Gateway
│  ├─ /business/sme
│  ├─ /business/salary
│  ├─ /business/enterprise
│  └─ /business/gateway
│
├─ /me/* (Account Hub)
│  ├─ /me (Overview)
│  ├─ /me/profile
│  ├─ /me/settings
│  ├─ /me/kyc
│  ├─ /me/recovery
│  ├─ /me/wallet
│  ├─ /me/activity
│  └─ /me/2fa
│
├─ /savings (Savings Products)
├─ /lending (Lending Products)
├─ /bills (Bill Payments)
│
└─ /auth/*
   ├─ /auth/signin
   └─ /auth/2fa
```

## 3. Feature Grouping Logic

```
SEND HUB (/send/*)
└─ Core: Transfer money between users (P2P)
   ├─ Features:
   │  ├─ P2P Transfers (main)
   │  ├─ International Transfers
   │  ├─ Transaction History
   │  └─ Frequent Recipients
   └─ Related: Mint/Burn (accessible via tab)

MINT HUB (/mint/*)
└─ Core: Create/Redeem AFK currency
   ├─ Features:
   │  ├─ Mint (convert to AFK)
   │  ├─ Burn (redeem from AFK)
   │  └─ Exchange Rates (info)
   └─ Related: Accessible from Send page tab

BUSINESS HUB (/business/*)
└─ Core: Business financial tools
   ├─ Features:
   │  ├─ SME Services
   │  ├─ Payroll Management
   │  ├─ Enterprise Bulk Operations
   │  └─ Payment Gateway
   └─ Related: Settings, API access

ACCOUNT HUB (/me/*)
└─ Core: Personal account & security
   ├─ Features:
   │  ├─ Profile Management
   │  ├─ Account Settings
   │  ├─ KYC Verification
   │  ├─ Recovery Methods
   │  ├─ Wallet Management
   │  ├─ Activity History
   │  └─ 2FA Setup
   └─ Related: Security settings
```

## 4. Data Flow (Example: Send Money)

```
User Taps "Send"
    ↓
/send Page Loads
    ├─ Display Balance
    ├─ Show Recent Recipients
    └─ Display Transaction History
    ↓
User Clicks "New Transfer"
    ↓
Send Dialog Opens
    ├─ Select Recipient
    ├─ Enter Amount (AFK)
    ├─ Optional Note
    └─ Calculate Fees
    ↓
User Clicks "Continue"
    ↓
Confirmation Dialog
    ├─ Review All Details
    ├─ Recipient Name
    ├─ Amount (AFK)
      └─ Fees: Stellar network fee (XLM / stroops), ledger-entry rent/reserve if applicable, ACBU processing fee if applicable
    ↓
User Confirms
    ↓
POST /api/send
    ├─ Validate Amount
    ├─ Check Balance
    ├─ Create Transaction
    └─ Update Balance
    ↓
Success Dialog
    └─ Transaction Status → Pending
    ↓
Updated History
    └─ New transaction appears in list
```

## 5. Component Hierarchy

```
<RootLayout>
  └─ <body>
     └─ <AppLayout>
        ├─ <DesktopSidebar> (md and up, sticky left)
        │  ├─ <SidebarLink> Home
        │  ├─ <SidebarLink> Send
        │  ├─ <SidebarLink> Mint
        │  ├─ <SidebarLink> Business
        │  ├─ <SidebarLink> Wallet
        │  └─ <SidebarLink> Me
        │
        ├─ <main> (Dynamic Content)
        │  ├─ [Page Content]
        │  ├─ <Card>
        │  ├─ <Button>
        │  ├─ <Dialog>
        │  └─ <Tabs>
        │
        └─ <MobileNav> (Fixed Bottom, below md)
           ├─ <NavItem> Home
           ├─ <NavItem> Send
           ├─ <NavItem> Mint
           ├─ <NavItem> Business
           ├─ <NavItem> Wallet
           └─ <NavItem> Me
```

## 6. Currency Display Convention

```
AFK Display Format
├─ Balance: "AFK 1,234.50"
├─ Amounts: "AFK 250.00"
├─ Fees: "AFK 0.50"
├─ Minimums: "Minimum AFK 10"
└─ Currency Code: "AFK" (always, never $)

Examples:
✅ "Send AFK 500"
✅ "Balance: AFK 12,345.67"
✅ "Fee: AFK 1.00"
✅ "Minimum: AFK 10"

❌ "$500"
❌ "Send USD 500"
❌ "Balance: 12,345.67"
❌ "Fee: $1.00"
```

## 7. Page Layout Pattern

```
┌─────────────────────────────────────┐
│         STICKY HEADER               │  ← Back button + Title
├─────────────────────────────────────┤
│     QUICK NAV / FILTERS             │  ← Tabs or filter buttons
├─────────────────────────────────────┤
│                                     │
│                                     │
│        SCROLLABLE CONTENT           │  ← Main page content
│                                     │
│                                     │
│                                     │
├─────────────────────────────────────┤
│      (Empty space for nav)          │  ← pb-24 padding (mobile only)
│                                     │
│                                     │
└─────────────────────────────────────┘
    ┌───────────────────────────────┐
    │   Mobile Navigation Bar       │  ← Fixed bottom, hidden from md
    └───────────────────────────────┘
```

On `md` and up the tab bar is replaced by a fixed-width sidebar on the left
and the `pb-24` clearance is dropped (`md:pb-0`):

```
┌────────────┬────────────────────────────┐
│            │      STICKY HEADER         │
│  SIDEBAR   ├────────────────────────────┤
│  (sticky)  │      SCROLLABLE CONTENT    │
│            │                            │
└────────────┴────────────────────────────┘
```

## 8. User Journey Map

```
FIRST TIME USER
└─ /auth/signin
   └─ Email/Password
      └─ /auth/2fa
         └─ Enter Code
            └─ / (Home Dashboard)
               ├─ Tutorial overlay
               ├─ Setup 2FA
               └─ Complete KYC

RETURNING USER
└─ /auth/signin
   └─ / (Home Dashboard)
      ├─ Quick actions
      ├─ Recent activity
      └─ Navigate to features

SEND MONEY JOURNEY
└─ / (Home)
   └─ Click "Send"
      └─ /send
         ├─ Tab: P2P
         ├─ Click: New Transfer
         ├─ Dialog: Enter Details
         ├─ Dialog: Confirm
         └─ Tab: History (see new transaction)

BUSINESS OWNER JOURNEY
└─ / (Home)
   └─ Click "Business"
      └─ /business
         ├─ Select Service
         ├─ /business/salary
         ├─ Create Batch
         ├─ Review
         └─ Disburse

ACCOUNT MANAGEMENT JOURNEY
└─ / (Home)
   └─ Click "Me"
      └─ /me
         ├─ View Profile
         ├─ Update Settings
         ├─ Verify KYC
         └─ Setup Recovery
```

## 9. API Integration Points

```
App State Management
│
├─ GET /user/profile
│  └─ Display in /me/profile
│
├─ GET /account/balance
│  └─ Display on all pages
│
├─ POST /send
│  └─ Process from /send page
│
├─ GET /send/history
│  └─ Display in /send history tab
│
├─ POST /mint
│  └─ Process from /mint/mint
│
├─ POST /burn
│  └─ Process from /mint/burn
│
├─ GET /business/services
│  └─ Display on /business
│
├─ POST /business/salary/disburse
│  └─ Process from /business/salary
│
├─ POST /kyc/start
│  └─ Initiate from /me/kyc
│
└─ GET /bills/catalog
   └─ Display on /bills
```

## 10. Error Handling Flow

```
User Action
    ↓
API Call
    ↓
Response
├─ Success (200, 201)
│  └─ Show Success Dialog
│     └─ Update UI
│
├─ Validation Error (400)
│  └─ Show Field Errors
│     └─ User corrects input
│
├─ Unauthorized (401)
│  └─ Redirect to /auth/signin
│
├─ Not Found (404)
│  └─ Show Generic Error
│     └─ Retry or Go Back
│
├─ Server Error (500)
│  └─ Show Error Dialog
│     └─ Suggest Retry
│
└─ Network Error
   └─ Show Offline Message
      └─ Retry Button
```

---

## Legend

```
→   Data/Navigation Flow
├─  Hierarchical Branch
└─  Final Item
*   Route Wildcard
()  Example/Note
✅  Correct Format
❌  Incorrect Format
```
