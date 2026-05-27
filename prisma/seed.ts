import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Default 10-currency basket weights (docs); used only for initial seed. Runtime uses BasketConfig from DB. */
const INITIAL_BASKET: { currency: string; weight: number }[] = [
  { currency: 'NGN', weight: 18 },
  { currency: 'ZAR', weight: 15 },
  { currency: 'KES', weight: 12 },
  { currency: 'EGP', weight: 11 },
  { currency: 'GHS', weight: 9 },
  { currency: 'RWF', weight: 8 },
  { currency: 'XOF', weight: 8 },
  { currency: 'MAD', weight: 7 },
  { currency: 'TZS', weight: 6 },
  { currency: 'UGX', weight: 6 },
];

async function main() {
  console.log('Seeding database...');

  const args = process.argv.slice(2);
  const truncate = args.includes("--truncate");

  if (truncate) {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED_TRUNCATE !== "true") {
      console.error("Refusing to truncate database in production. Set ALLOW_SEED_TRUNCATE=true to override.");
      process.exit(1);
    }
    console.log('Truncating seed-target tables (safe mode)...');
    // Only truncate tables known to be seeded by this script. Keep this conservative.
    await prisma.basketConfig.deleteMany({});
    console.log('Truncated BasketConfig.');
  }

  const effectiveFrom = new Date(0); // epoch so "current" from start
  // Use createMany with skipDuplicates to make repeated runs idempotent.
  await prisma.basketConfig.createMany({
    data: INITIAL_BASKET.map(({ currency, weight }) => ({
      effectiveFrom,
      currency,
      weight,
      status: 'active',
    })),
    skipDuplicates: true,
  });

  console.log('Seeded initial 10-currency basket (BasketConfig).');
  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
