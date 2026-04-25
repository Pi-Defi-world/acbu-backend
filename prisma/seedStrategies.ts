/**
 * Seed investment strategies for testing and development
 */
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function seedStrategies() {
  console.log("Seeding investment strategies...");

  const strategies: Prisma.InvestmentStrategyCreateInput[] = [
    {
      name: "Stellar Liquidity Pool - USDC/XLM",
      description:
        "Provide liquidity to Stellar DEX USDC/XLM pool for trading fees",
      status: "active",
      policyLimitUsd: new Prisma.Decimal("50000.00"),
      deployedNotionalUsd: new Prisma.Decimal("0.00"),
      targetApyBps: 450, // 4.5% APY
      riskTier: "low",
    },
    {
      name: "Soroban Lending Protocol",
      description: "Lend USDC on Soroban-based lending protocol",
      status: "active",
      policyLimitUsd: new Prisma.Decimal("100000.00"),
      deployedNotionalUsd: new Prisma.Decimal("0.00"),
      targetApyBps: 650, // 6.5% APY
      riskTier: "medium",
    },
    {
      name: "Stellar Anchor Deposits",
      description: "Deposit USDC with regulated Stellar anchors for yield",
      status: "active",
      policyLimitUsd: new Prisma.Decimal("200000.00"),
      deployedNotionalUsd: new Prisma.Decimal("0.00"),
      targetApyBps: 350, // 3.5% APY
      riskTier: "low",
    },
  ];

  for (const strategy of strategies) {
    const existing = await prisma.investmentStrategy.findUnique({
      where: { name: strategy.name },
    });

    if (existing) {
      console.log(`Strategy "${strategy.name}" already exists, skipping`);
      continue;
    }

    await prisma.investmentStrategy.create({ data: strategy });
    console.log(`Created strategy: ${strategy.name}`);
  }

  console.log("Strategy seeding complete");
}

seedStrategies()
  .catch((e) => {
    console.error("Error seeding strategies:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
