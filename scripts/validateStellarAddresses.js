/**
 * B-013: Quick validation script for existing stellar addresses
 * Run with: node scripts/validateStellarAddresses.js
 */

const { PrismaClient } = require("@prisma/client");
const { StrKey } = require("@stellar/stellar-sdk");

const prisma = new PrismaClient();

// Common placeholder patterns
const PLACEHOLDER_PATTERNS = [
  /^G[A]{55}$/,
  /^G[B]{55}$/,
  /^G[0]{55}$/,
  /^GTEST/,
  /^GDUMMY/,
  /^GPLACEHOLDER/,
  /^GXXXXXXXX/,
];

function isValidStellarAddress(address) {
  if (!address || typeof address !== "string") return false;
  if (address.length !== 56) return false;
  if (!address.startsWith("G")) return false;
  return StrKey.isValidEd25519PublicKey(address);
}

function isPlaceholderAddress(address) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(address));
}

async function validateStellarAddresses() {
  console.log("🔍 Validating existing stellar addresses in database...\n");

  try {
    const usersWithAddress = await prisma.user.findMany({
      where: {
        stellarAddress: {
          not: null,
        },
      },
      select: {
        id: true,
        stellarAddress: true,
        username: true,
        createdAt: true,
      },
    });

    console.log(`Found ${usersWithAddress.length} users with stellar addresses\n`);

    const invalidAddresses = [];

    for (const user of usersWithAddress) {
      const issues = [];
      const address = user.stellarAddress;

      if (address.length !== 56) {
        issues.push(`Invalid length: ${address.length} (expected 56)`);
      }

      if (!address.startsWith("G")) {
        issues.push("Does not start with 'G'");
      }

      if (!isValidStellarAddress(address)) {
        issues.push("Fails StrKey.isValidEd25519PublicKey validation");
      }

      if (isPlaceholderAddress(address)) {
        issues.push("Matches placeholder pattern");
      }

      if (issues.length > 0) {
        invalidAddresses.push({
          userId: user.id,
          username: user.username,
          stellarAddress: address,
          createdAt: user.createdAt,
          issues,
        });
      }
    }

    if (invalidAddresses.length === 0) {
      console.log("✅ All stellar addresses are valid!");
      console.log("✅ Safe to apply migration: 20260426000000_add_stellar_address_validation\n");
      return true;
    } else {
      console.log(`❌ Found ${invalidAddresses.length} invalid address(es):\n`);

      for (const invalid of invalidAddresses) {
        console.log(`User: ${invalid.userId}`);
        console.log(`Username: ${invalid.username || "(none)"}`);
        console.log(`Created: ${invalid.createdAt.toISOString()}`);
        console.log(`Address: ${invalid.stellarAddress}`);
        console.log(`Issues: ${invalid.issues.join(", ")}`);
        console.log("---\n");
      }

      console.log("⚠️  Please fix these addresses before applying the migration.\n");
      console.log("Options:");
      console.log("1. Delete invalid addresses: UPDATE users SET stellar_address = NULL WHERE id = '...'");
      console.log("2. Replace with valid addresses (if user has a real wallet)");
      console.log("3. Contact affected users to provide valid addresses\n");

      return false;
    }
  } catch (error) {
    console.error("❌ Error validating addresses:", error.message);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

validateStellarAddresses()
  .then((isValid) => {
    process.exit(isValid ? 0 : 1);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
