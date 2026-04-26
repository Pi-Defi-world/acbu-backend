/**
 * B-013: Validate stellar addresses using Prisma
 * Run with: npx ts-node scripts/validateWithPrisma.ts
 */

import { PrismaClient } from "@prisma/client";
import { isValidStellarAddress } from "../src/utils/stellar";

const prisma = new PrismaClient();

const PLACEHOLDER_PATTERNS = [
  /^G[A]{55}$/,
  /^G[B]{55}$/,
  /^G[0]{55}$/,
  /^GTEST/,
  /^GDUMMY/,
  /^GPLACEHOLDER/,
  /^GXXXXXXXX/,
];

function isPlaceholder(address: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(address));
}

async function main() {
  console.log("🔍 B-013: Validating Stellar Addresses\n");

  try {
    const users = await prisma.user.findMany({
      where: { stellarAddress: { not: null } },
      select: {
        id: true,
        username: true,
        stellarAddress: true,
        createdAt: true,
      },
    });

    console.log(`Found ${users.length} users with stellar addresses\n`);

    const invalid: any[] = [];

    for (const user of users) {
      const issues: string[] = [];
      const addr = user.stellarAddress!;

      if (addr.length !== 56) issues.push(`Wrong length: ${addr.length}`);
      if (!addr.startsWith("G")) issues.push("Doesn't start with G");
      if (!isValidStellarAddress(addr)) issues.push("Invalid StrKey checksum");
      if (isPlaceholder(addr)) issues.push("Placeholder pattern");

      if (issues.length > 0) {
        invalid.push({ ...user, issues });
      }
    }

    if (invalid.length === 0) {
      console.log("✅ All stellar addresses are valid!");
      console.log("✅ Safe to apply migration\n");
    } else {
      console.log(`❌ Found ${invalid.length} invalid address(es):\n`);
      invalid.forEach((u) => {
        console.log(`User: ${u.id}`);
        console.log(`Username: ${u.username || "(none)"}`);
        console.log(`Address: ${u.stellarAddress}`);
        console.log(`Issues: ${u.issues.join(", ")}`);
        console.log("---\n");
      });
      console.log("⚠️  Fix these before deploying migration\n");
    }

    console.log("Summary:");
    console.log(`  Total with addresses: ${users.length}`);
    console.log(`  Valid: ${users.length - invalid.length}`);
    console.log(`  Invalid: ${invalid.length}`);
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    if (error.message.includes("DATABASE_URL")) {
      console.error("\nPlease set DATABASE_URL in .env file");
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
