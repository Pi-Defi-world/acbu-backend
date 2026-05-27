import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database (orchestrator)...');

  const args = process.argv.slice(2);
  const truncate = args.includes('--truncate');

  if (truncate) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED_TRUNCATE !== 'true') {
      console.error('Refusing to truncate database in production. Set ALLOW_SEED_TRUNCATE=true to override.');
      process.exit(1);
    }

    console.log('Truncating seed-target tables (conservative list)...');
    // Conservative: only tables we know are seeded by the included scripts.
    try {
      await prisma.$transaction([
        prisma.basketConfig.deleteMany({}),
        prisma.investmentStrategy.deleteMany({}),
      ]);
      console.log('Truncated: BasketConfig, InvestmentStrategy');
    } catch (e) {
      console.error('Error truncating seed tables:', e);
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  try {
    console.log('Running prisma/seed.ts');
    execSync('pnpm exec ts-node prisma/seed.ts', { stdio: 'inherit' });

    console.log('Running prisma/seedStrategies.ts');
    execSync('pnpm exec ts-node prisma/seedStrategies.ts', { stdio: 'inherit' });

    console.log('All seeds completed successfully.');
  } catch (e) {
    console.error('Seeding failed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Unexpected error in seed orchestrator:', e);
  process.exit(1);
});
