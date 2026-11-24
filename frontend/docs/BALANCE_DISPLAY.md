# Balance Display Patterns - Issue #205

## Overview
This document explains how to properly fetch and display user balances without showing unreliable "—" placeholders.

## Components & Hooks

### 1. **`useBalance()` Hook** (Already Exists)
**Location:** `hooks/use-balance.ts`

Fetches the user's ACBU wallet balance from `/users/me/balance` endpoint.



**Returns:**
```typescript
{
  balance: number | null;           // Numeric ACBU balance
  balanceSource?: string;            // 'stellar' | 'app_ledger' | 'none'
  loading: boolean;                  // true while fetching
  error: string;                     // error message if fetch failed
  refresh: () => void;               // manually refresh balance
}
```

**Usage Example:**
```tsx
const { balance, loading, error } = useBalance();

if (error) {
  return <div className="text-destructive">{error}</div>;
}

if (loading) {
  return <BalanceSkeleton variant="full" />;
}

return <div>AFK {formatAmount(balance)}</div>;
```

### 2. **`<BalanceSkeleton />` Component** (New)
**Location:** `components/ui/balance-skeleton.tsx`

A loading placeholder for balance displays. **Never show "—" while loading.**

**Variants:**
- `full` (default): Shows 2 skeleton lines (main balance + USD equivalent)
- `compact`: Shows single line (for inline displays)

**Usage Examples:**

**Full variant (Large balance display):**
```tsx
import { BalanceSkeleton } from '@/components/ui/balance-skeleton';
import { useBalance } from '@/hooks/use-balance';

export function BalanceCard() {
  const { balance, loading, error } = useBalance();

  if (loading) {
    return (
      <div className="rounded-lg border p-5">
        <p className="text-sm text-muted-foreground mb-2">Wallet Balance</p>
        <BalanceSkeleton variant="full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5">
        <p className="text-sm text-destructive">Failed to load balance: {error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-5">
      <p className="text-sm text-muted-foreground mb-2">Wallet Balance</p>
      <h2 className="text-3xl font-bold">AFK {formatAmount(balance)}</h2>
    </div>
  );
}
```

**Compact variant (Inline display):**
```tsx
export function BalanceBadge() {
  const { balance, loading, error } = useBalance();

  if (loading) {
    return <BalanceSkeleton variant="compact" />;
  }

  if (error) {
    return <span className="text-muted-foreground">Unavailable</span>;
  }

  return <span>AFK {formatAmount(balance)}</span>;
}
```

## ❌ What NOT to Do

**Never show "—" (em dash) or "..." as a placeholder:**

```tsx
// ❌ BAD - Shows unreliable "—" to users
{balance == null ? '—' : `AFK ${formatAmount(balance)}`}

// ❌ BAD - Shows "..." during load
{loading ? '...' : `AFK ${formatAmount(balance)}`}
```

**Why?** Users cannot trust the placeholder and may think the balance is genuinely unavailable or zero.

## ✅ Best Practices

1. **Always check `loading` state first**
   ```tsx
   if (loading) return <BalanceSkeleton />;
   ```

2. **Handle errors explicitly**
   ```tsx
   if (error) return <ErrorMessage>{error}</ErrorMessage>;
   ```

3. **Only show balance when data is ready**
   ```tsx
   return <div>AFK {formatAmount(balance)}</div>;
   ```

4. **Use appropriate skeleton variant**
   - `full` for dashboard balance cards
   - `compact` for inline badges, pills, headers

5. **Provide refresh capability**
   ```tsx
   const { balance, loading, error, refresh } = useBalance();
   
   <button onClick={refresh} disabled={loading}>
     Refresh Balance
   </button>
   ```

## Fixing Existing Code

If you find balance displays showing "—", replace with:

```tsx
// Before
{balance == null ? '—' : `AFK ${formatAmount(balance)}`}

// After
{loading ? <BalanceSkeleton variant="compact" /> : `AFK ${formatAmount(balance)}`}
```

## API Endpoint

The hook uses: `GET /users/me/balance`

Returns:
```json
{
  "balance": "1234.56",
  "currency": "AFK",
  "stellar_address": "GXXXXXX...",
  "balance_stellar": "1234.56",
  "balance_app_ledger": "1234.56",
  "balance_source": "stellar"
}
```

## Testing

Test all states:
1. **Loading:** Watch for smooth skeleton animation
2. **Success:** Verify balance displays correctly
3. **Error:** Ensure error message is helpful
4. **Offline:** Verify graceful degradation

