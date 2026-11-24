/**
 * B-013: Validate existing stellar addresses in the database
 * Run this script BEFORE applying the migration to ensure no invalid addresses exist
 *
 * Usage: npx ts-node prisma/validateStellarAddresses.ts
 */
import { PrismaClient } from "@prisma/client";
import { isPlaceholderStellarAddress, isValidStellarAddress } from "../src/utils/stellar";

const prisma = new PrismaClient();

async function validateStellarAddresses() {
  console.log("🔍 Validating existing stellar addresses in database...\n");

  try {
    // Get all users with stellarAddress set
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

    const invalidAddresses: Array<{
      userId: string;
      username: string | null;
      stellarAddress: string;
      createdAt: Date;
      issues: string[];
    }> = [];

    for (const user of usersWithAddress) {
      const issues: string[] = [];
      const address = user.stellarAddress!;

      // Check length
      if (address.length !== 56) {
        issues.push(`Invalid length: ${address.length} (expected 56)`);
      }

      // Check starts with G
      if (!address.startsWith("G")) {
        issues.push("Does not start with 'G'");
      }

      // Check valid Stellar format
      if (!isValidStellarAddress(address)) {
        issues.push("Fails StrKey.isValidEd25519PublicKey validation");
      }

      // Check placeholder patterns
      if (isPlaceholderStellarAddress(address)) {
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

      console.log(
        "⚠️  Migration 20261121000000_purge_invalid_stellar_addresses will clear these.\n",
      );
      console.log("Options before deploying:");
      console.log(
        "1. Delete invalid addresses: UPDATE users SET stellar_address = NULL WHERE id = '...'",
      );
      console.log("2. Replace with valid addresses (if user has a real wallet)");
      console.log("3. Contact affected users to provide valid addresses\n");

      return false;
    }
  } catch (error) {
    console.error("❌ Error validating addresses:", error);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// Run validation
validateStellarAddresses()
  .then((isValid) => {
    process.exit(isValid ? 0 : 1);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
