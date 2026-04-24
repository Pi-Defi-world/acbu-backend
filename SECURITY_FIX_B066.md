# B-066: 2FA Challenge Token Purpose Binding Security Fix

## Vulnerability Summary

**Issue**: 2FA challenge tokens could potentially be reused across different authentication flows if purpose checking was incomplete, allowing attackers to bypass API access restrictions.

**Severity**: Medium  
**Area**: Backend Authentication (`src/utils/jwt.ts`, `src/middleware/auth.ts`)  
**Impact**: Token confusion attack; potential unauthorized access if tokens aren't properly bound to their intended use

---

## Root Cause Analysis

The original implementation had several weaknesses:

1. **Weak Purpose Binding**: Tokens only had a string `purpose` field that wasn't a standard JWT claim
2. **No Audience/Issuer Claims**: Lacked `aud` (audience) and `iss` (issuer) claims for strict token validation
3. **Shared Secret**: Challenge tokens used the same `JWT_SECRET` as other tokens without clear separation
4. **No Token Rejection Logic**: API endpoints didn't explicitly check for and reject challenge tokens

### Attack Vector

```
1. Attacker intercepts 2FA challenge token during signin
2. Token validation only checks: decoded.purpose === "signin_2fa"
3. Without strict aud/iss claims, token could be reused in other JWT verification contexts
4. If 2FA endpoint and API endpoint both validated tokens loosely, same token could work for both
5. Result: Unauthorized API access without completing 2FA
```

---

## Security Fix Implementation

### 1. Enhanced JWT Utility (`src/utils/jwt.ts`)

**Changes**:
- Added standard JWT claims: `aud="2fa_challenge"` and `iss="acbu/auth"`
- Added unique `jti` (JWT ID) for token tracking and revocation
- Strict verification enforces audience and issuer matching
- New `rejectIfChallengeToken()` function for explicit token rejection

**Key Improvements**:

```typescript
// Before: Only string purpose field
{ userId, purpose: "signin_2fa" }

// After: Standard JWT claims with strict binding
{ userId, aud: "2fa_challenge", iss: "acbu/auth", jti: "chal_..." }
```

**JWT Verification Enforcement**:
```typescript
jwt.verify(token, secret, {
  audience: "2fa_challenge",
  issuer: "acbu/auth"
});
```

### 2. Configuration Support (`src/config/env.ts`)

Added optional `CHALLENGE_TOKEN_SECRET` environment variable for token secret rotation:

```bash
# Optional: Use dedicated secret for challenge tokens (recommended for production)
CHALLENGE_TOKEN_SECRET=your-rotated-challenge-secret

# Fallback: Uses JWT_SECRET if not set
JWT_SECRET=your-main-jwt-secret
```

**Benefits**:
- Allows independent secret rotation for challenge tokens
- Enables key/secret separation following JWT best practices
- Maintains backward compatibility

### 3. API Middleware Protection (`src/middleware/auth.ts`)

New `rejectIfJwtToken()` function that:
- Detects JWT tokens attempting to be used as API keys
- Specifically identifies and rejects challenge tokens with `aud="2fa_challenge"`
- Returns 401 error with audit logging

**Validation Flow**:
```
API Request with credential
    ↓
Check for JWT token format (3 parts: header.payload.signature)
    ↓
Decode without verification to inspect audience
    ↓
If aud="2fa_challenge" and iss="acbu/auth" → REJECT
    ↓
Otherwise, proceed with normal API key validation
```

---

## Technical Specifications

### Challenge Token Claims

| Claim | Value | Purpose |
|-------|-------|---------|
| `userId` | user ID | Identifies token subject |
| `aud` | `2fa_challenge` | Audience: marks token for 2FA only |
| `iss` | `acbu/auth` | Issuer: identifies auth service |
| `jti` | `chal_<userId>_<timestamp>` | Unique token ID for tracking |
| `exp` | now + 5 minutes | Strict expiration |
| `iat` | current timestamp | Issued at |

### Token Format Examples

**Challenge Token (JWT)**:
```json
{
  "header": { "alg": "HS256", "typ": "JWT" },
  "payload": {
    "userId": "user-12345",
    "aud": "2fa_challenge",
    "iss": "acbu/auth",
    "jti": "chal_user-12345_1703001234567",
    "iat": 1703001234,
    "exp": 1703001534
  },
  "signature": "..." // HS256 signed with CHALLENGE_TOKEN_SECRET
}
```

**Rejected Attempted Reuse**:
```
API Request:
  Authorization: Bearer <challenge_token>
  
Middleware Response:
  401 Unauthorized
  "Challenge tokens cannot be used for API access"
```

---

## Validation & Testing

### Unit Tests (`tests/jwt.test.ts`)

Comprehensive test coverage for:
- ✅ Challenge token creation with proper claims
- ✅ Token verification with audience/issuer enforcement
- ✅ Rejection of tokens with wrong audience/issuer
- ✅ Expired token rejection
- ✅ Tampered token signature rejection
- ✅ Explicit rejection of challenge tokens for API access
- ✅ Token confusion prevention
- ✅ Multiple flow reuse scenarios

### Integration Tests (`tests/auth-middleware.test.ts`)

API middleware validation:
- ✅ Challenge token rejection in x-api-key header
- ✅ Challenge token rejection in Authorization Bearer header
- ✅ Proper error logging for audit trail
- ✅ Valid API key format acceptance (unchanged)
- ✅ Malformed JWT rejection
- ✅ Different JWT audience rejection
- ✅ Edge case: attacker-modified claims still rejected

### Acceptance Criteria (All Met)

**Acceptance Check**: Cannot reuse challenge token for API access

- ✅ Challenge tokens have explicit `aud="2fa_challenge"` claim
- ✅ API middleware detects and rejects challenge tokens
- ✅ Rejection logged with user context for audit trail
- ✅ Proper HTTP 401 status code
- ✅ Clear error messaging: "Challenge tokens cannot be used for API access"

---

## Deployment Checklist

### Before Deployment

- [ ] Review and merge JWT utility changes
- [ ] Review and merge config changes
- [ ] Review and merge middleware changes
- [ ] All tests passing (both new tests and existing regression tests)
- [ ] No breaking changes to API contracts

### At Deployment Time

1. **Standard Deployment** (if not rotating secrets):
   - Deploy code changes
   - Verify tests pass in CI/CD
   - Monitor logs for any JWT validation errors

2. **With Secret Rotation** (recommended for production):
   - Generate new `CHALLENGE_TOKEN_SECRET` (different from `JWT_SECRET`)
   - Set `CHALLENGE_TOKEN_SECRET` in environment variables
   - Deploy code changes
   - Verify new tokens use dedicated secret in logs
   - Monitor audit logs for token rejection patterns

### Post-Deployment Verification

```bash
# Verify challenge tokens have proper claims
curl -X POST http://localhost:5000/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"identifier":"user@example.com","passcode":"1234"}'
  
# Check returned challenge_token JWT structure
# Should contain: aud="2fa_challenge", iss="acbu/auth"

# Verify API rejection
curl -X GET http://localhost:5000/api/user \
  -H "Authorization: Bearer <challenge_token_from_above>"
  
# Should respond: 401 Unauthorized
# Message: "Challenge tokens cannot be used for API access"
```

---

## Migration Path for Existing Tokens

**Q**: What happens to existing challenge tokens in the wild?

**A**: 
- All existing non-compliant tokens will **fail verification** because they lack `aud` and `iss` claims
- Users with active 2FA flows will need to **re-attempt signin** to get new compliant tokens
- This is acceptable because:
  - Challenge tokens are short-lived (5 minutes)
  - Only active signin processes affected
  - No data loss or critical impact
  - Security gain justifies UX inconvenience

---

## Performance Impact

- ✅ **Minimal overhead**: JWT claim validation is negligible
- ✅ **No database queries added**: JWT.verify() is crypto operation only
- ✅ **No new dependencies**: Uses existing `jsonwebtoken` library
- ✅ **Backward compatible**: Fallback to `JWT_SECRET` if `CHALLENGE_TOKEN_SECRET` not set

---

## Related Security Practices

This fix implements JWT best practices:
1. **RFC 7519 Compliance**: Uses standard `aud` and `iss` claims
2. **Token Purpose Binding**: Clear audience for each token type
3. **Token Unique Identification**: `jti` enables revocation tracking
4. **Explicit Rejection**: Middleware explicitly prevents misuse
5. **Secret Separation**: Optional dedicated secret for 2FA tokens

---

## Monitoring & Debugging

### Audit Logging

All challenge token rejections are logged:

```
ERROR "Attempted to use 2FA challenge token for API access"
  userId: "user-12345"
  jti: "chal_user-12345_1703001234567"
```

### Debug Mode

Enable verbose JWT logging:
```bash
LOG_LEVEL=debug npm start
```

Look for:
- `Challenge token verification failed` → Token validation issues
- `Challenge token audience mismatch` → `aud` claim problem  
- `Challenge token issuer mismatch` → `iss` claim problem
- `Attempted to use 2FA challenge token for API access` → Reuse attempt

---

## References & Standards

- [RFC 7519 - JSON Web Token (JWT)](https://tools.ietf.org/html/rfc7519)
- [JWT.io - Introduction](https://jwt.io/introduction)
- [OWASP - JWT Attacks](https://owasp.org/www-community/attacks/JWT)
- [NIST SP 800-63B - Authentication and Lifecycle Management](https://pages.nist.gov/800-63-3/sp800-63b.html)

---

## Questions & Support

For issues or questions about this security fix:

1. Check test files for usage examples
2. Review middleware test cases for edge cases
3. Consult JWT utility documentation in code comments
4. Check logs for specific validation errors

---

**Last Updated**: April 2026  
**Status**: ✅ Complete & Tested  
**Security Level**: Medium Risk Remediation
