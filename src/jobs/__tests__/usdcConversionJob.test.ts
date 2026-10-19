import { Decimal } from "@prisma/client/runtime/library";
import {
  calculateBasketDistribution,
  processUsdcConversion,
  startUsdcConversionConsumer,
  enqueueUsdcConversion,
  claimTransaction,
  releaseClaim,
  USDC_CONVERSION_DECIMALS,
  type UsdcConversionPayload,
} from "../usdcConversionJob";
import { basketService, type BasketEntry } from "../../services/basket";
import { getFintechRouter } from "../../services/fintech";
import { prisma } from "../../config/database";
import { connectRabbitMQ, assertQueueWithDLQ, QUEUES } from "../../config/rabbitmq";
import type { Channel, ConsumeMessage } from "amqplib";

jest.mock("../../config/database", () => ({
  prisma: {
    reserveHistory: {
      create: jest.fn(),
    },
    transaction: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock("../../services/basket", () => ({
  basketService: {
    getCurrentBasket: jest.fn(),
  },
}));

jest.mock("../../services/fintech", () => ({
  getFintechRouter: jest.fn(),
}));

jest.mock("../../config/rabbitmq", () => ({
  connectRabbitMQ: jest.fn(),
  assertQueueWithDLQ: jest.fn(),
  QUEUES: {
    USDC_CONVERSION: "usdc_conversion",
  },
}));

jest.mock("../../config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("usdcConversionJob - calculateBasketDistribution", () => {
  const standardBasket: BasketEntry[] = [
    { currency: "NGN", weight: 18 },
    { currency: "ZAR", weight: 15 },
    { currency: "KES", weight: 12 },
    { currency: "EGP", weight: 11 },
    { currency: "GHS", weight: 9 },
    { currency: "RWF", weight: 8 },
    { currency: "XOF", weight: 8 },
    { currency: "MAD", weight: 7 },
    { currency: "TZS", weight: 6 },
    { currency: "UGX", weight: 6 },
  ];

  it("calculates exact shares for standard 10-currency basket without precision loss", () => {
    const usdcAmount = "100";
    const shares = calculateBasketDistribution(usdcAmount, standardBasket);

    expect(shares).toHaveLength(10);
    expect(shares.find((s) => s.currency === "NGN")?.amountDecimal.toString()).toBe("18");
    expect(shares.find((s) => s.currency === "ZAR")?.amountDecimal.toString()).toBe("15");
    expect(shares.find((s) => s.currency === "KES")?.amountDecimal.toString()).toBe("12");

    const sumAtomic = shares.reduce((sum, s) => sum + s.amountAtomic, 0n);
    const expectedAtomic = 100n * 10_000_000n;
    expect(sumAtomic).toBe(expectedAtomic);

    const sumDecimal = shares.reduce((sum, s) => sum.plus(s.amountDecimal), new Decimal(0));
    expect(sumDecimal.equals(new Decimal("100"))).toBe(true);
  });

  it("handles uneven splits (33.33% / 33.33% / 33.34%) with zero residual drift", () => {
    const unevenBasket: BasketEntry[] = [
      { currency: "AAA", weight: 33.33 },
      { currency: "BBB", weight: 33.33 },
      { currency: "CCC", weight: 33.34 },
    ];

    const testAmounts = ["10", "100.5", "0.0000001", "123.4567891", "9999999.9999999"];

    for (const amountStr of testAmounts) {
      const shares = calculateBasketDistribution(amountStr, unevenBasket);
      expect(shares).toHaveLength(3);

      const targetAtomic = BigInt(
        new Decimal(amountStr)
          .mul(new Decimal(10).pow(USDC_CONVERSION_DECIMALS))
          .toFixed(0, Decimal.ROUND_DOWN),
      );
      const sumAtomic = shares.reduce((sum, s) => sum + s.amountAtomic, 0n);
      expect(sumAtomic).toBe(targetAtomic);

      const sumDecimal = shares.reduce((sum, s) => sum.plus(s.amountDecimal), new Decimal(0));
      expect(sumDecimal.equals(new Decimal(amountStr))).toBe(true);
    }
  });

  it("handles 3-way equal splits of prime atomic amounts with exact remainder allocation", () => {
    const equalBasket: BasketEntry[] = [
      { currency: "AAA", weight: 1 },
      { currency: "BBB", weight: 1 },
      { currency: "CCC", weight: 1 },
    ];

    // 7 stroops = 0.0000007 USDC (prime number of stroops)
    const primeStroopAmount = "0.0000007";
    const shares7 = calculateBasketDistribution(primeStroopAmount, equalBasket);
    expect(shares7).toHaveLength(3);

    const sumAtomic7 = shares7.reduce((sum, s) => sum + s.amountAtomic, 0n);
    expect(sumAtomic7).toBe(7n);

    // 7 stroops / 3 = 2 stroops each with remainder of 1 stroop allocated to first
    expect(shares7.map((s) => s.amountAtomic)).toEqual([3n, 2n, 2n]);

    const sumDecimal7 = shares7.reduce((sum, s) => sum.plus(s.amountDecimal), new Decimal(0));
    expect(sumDecimal7.equals(new Decimal("0.0000007"))).toBe(true);
    expect(sumDecimal7.toFixed(7)).toBe("0.0000007");

    // 11 stroops = 0.0000011 USDC (prime number of stroops)
    const primeStroopAmount11 = "0.0000011";
    const shares11 = calculateBasketDistribution(primeStroopAmount11, equalBasket);
    expect(shares11.map((s) => s.amountAtomic)).toEqual([4n, 4n, 3n]);
    expect(shares11.reduce((sum, s) => sum + s.amountAtomic, 0n)).toBe(11n);
    const sumDecimal11 = shares11.reduce((sum, s) => sum.plus(s.amountDecimal), new Decimal(0));
    expect(sumDecimal11.equals(new Decimal("0.0000011"))).toBe(true);
  });

  it("allocates full amount for a single-currency basket without loss", () => {
    const singleBasket: BasketEntry[] = [{ currency: "NGN", weight: 100 }];
    const amount = "543.2109876";
    const shares = calculateBasketDistribution(amount, singleBasket);

    expect(shares).toHaveLength(1);
    expect(shares[0].currency).toBe("NGN");
    expect(shares[0].amountDecimal.toString()).toBe(amount);
    expect(shares[0].amountAtomic).toBe(5432109876n);
  });

  it("returns empty array for invalid, non-positive, or empty inputs", () => {
    expect(calculateBasketDistribution("0", standardBasket)).toEqual([]);
    expect(calculateBasketDistribution("-10", standardBasket)).toEqual([]);
    expect(calculateBasketDistribution("invalid", standardBasket)).toEqual([]);
    expect(calculateBasketDistribution("100", [])).toEqual([]);
  });

  it("guarantees sum(allocatedShares) === originalUsdcAmount across randomized arbitrary amounts and weights", () => {
    const arbitraryBaskets: BasketEntry[][] = [
      standardBasket,
      [
        { currency: "A", weight: 10.5 },
        { currency: "B", weight: 20.25 },
        { currency: "C", weight: 30.75 },
        { currency: "D", weight: 38.5 },
      ],
      [
        { currency: "X", weight: 1 },
        { currency: "Y", weight: 2 },
        { currency: "Z", weight: 3 },
        { currency: "W", weight: 4 },
        { currency: "V", weight: 5 },
      ],
      [
        { currency: "M", weight: 0.01 },
        { currency: "N", weight: 99.99 },
      ],
    ];

    const arbitraryAmounts = [
      "0.0000001",
      "0.0000003",
      "0.0000007",
      "0.0000013",
      "1.0000000",
      "7.7777777",
      "13.3333333",
      "33.3333333",
      "100.0000000",
      "987654.3210987",
      "12345678.9012345",
      "50000000.0000000",
    ];

    for (const basket of arbitraryBaskets) {
      for (const amountStr of arbitraryAmounts) {
        const shares = calculateBasketDistribution(amountStr, basket);
        const targetAtomic = BigInt(
          new Decimal(amountStr)
            .mul(new Decimal(10).pow(USDC_CONVERSION_DECIMALS))
            .toFixed(0, Decimal.ROUND_DOWN),
        );

        const sumAtomic = shares.reduce((sum, s) => sum + s.amountAtomic, 0n);
        expect(sumAtomic).toBe(targetAtomic);

        const sumDecimal = shares.reduce((sum, s) => sum.plus(s.amountDecimal), new Decimal(0));
        expect(sumDecimal.equals(new Decimal(amountStr))).toBe(true);
      }
    }
  });
});

describe("usdcConversionJob - processUsdcConversion", () => {
  const mockProvider = {
    convertCurrency: jest.fn(),
  };
  const mockRouter = {
    getProvider: jest.fn().mockResolvedValue(mockProvider),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getFintechRouter as jest.Mock).mockReturnValue(mockRouter);
    (basketService.getCurrentBasket as jest.Mock).mockResolvedValue([
      { currency: "NGN", weight: 60 },
      { currency: "ZAR", weight: 40 },
    ]);
    (prisma.reserveHistory.create as jest.Mock).mockResolvedValue({});
    (prisma.transaction.update as jest.Mock).mockResolvedValue({});
  });

  it("processes conversion using exact distribution and records reserve history with Decimal", async () => {
    const payload: UsdcConversionPayload = {
      usdcAmount: "100",
      recipient: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      txHash: "0xabcdef123456",
      transactionId: "tx-uuid-1",
    };

    await processUsdcConversion(payload);

    expect(basketService.getCurrentBasket).toHaveBeenCalled();
    expect(mockRouter.getProvider).toHaveBeenCalledWith("NGN");
    expect(mockRouter.getProvider).toHaveBeenCalledWith("ZAR");

    // Check convertCurrency called with exact shares
    expect(mockProvider.convertCurrency).toHaveBeenCalledWith(60, "USD", "NGN");
    expect(mockProvider.convertCurrency).toHaveBeenCalledWith(40, "USD", "ZAR");

    // Check reserve history created with exact Decimal
    expect(prisma.reserveHistory.create).toHaveBeenCalledWith({
      data: {
        currency: "NGN",
        amountChange: new Decimal(60),
        reason: "conversion",
        newAmount: null,
      },
    });
    expect(prisma.reserveHistory.create).toHaveBeenCalledWith({
      data: {
        currency: "ZAR",
        amountChange: new Decimal(40),
        reason: "conversion",
        newAmount: null,
      },
    });

    // Check transaction status marked completed
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "tx-uuid-1" },
      data: {
        status: "completed",
        blockchainTxHash: "0xabcdef123456",
        completedAt: expect.any(Date),
      },
    });
  });

  it("handles provider conversion failure without recording erroneous reserve entries", async () => {
    mockProvider.convertCurrency.mockImplementation(async (amount, from, to) => {
      if (to === "NGN") {
        throw new Error("FX provider offline");
      }
      return { amount: 100, rate: 1.5 };
    });

    const payload: UsdcConversionPayload = {
      usdcAmount: "100",
      recipient: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
      txHash: "0xabcdef123456",
    };

    await processUsdcConversion(payload);

    // Only ZAR should have recorded reserve history
    expect(prisma.reserveHistory.create).toHaveBeenCalledTimes(1);
    expect(prisma.reserveHistory.create).toHaveBeenCalledWith({
      data: {
        currency: "ZAR",
        amountChange: new Decimal(40),
        reason: "conversion",
        newAmount: null,
      },
    });
  });

  it("skips non-positive, invalid, or empty amounts", async () => {
    await processUsdcConversion({
      usdcAmount: "0",
      recipient: "GABC",
      txHash: "0x123",
    });

    await processUsdcConversion({
      usdcAmount: "-50",
      recipient: "GABC",
      txHash: "0x123",
    });

    await processUsdcConversion({
      usdcAmount: "not-a-number",
      recipient: "GABC",
      txHash: "0x123",
    });

    expect(basketService.getCurrentBasket).not.toHaveBeenCalled();
    expect(prisma.reserveHistory.create).not.toHaveBeenCalled();
  });
});

describe("usdcConversionJob - claims and consumer", () => {
  let mockChannel: Partial<Channel>;
  let consumerCallback: (msg: ConsumeMessage | null) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockChannel = {
      prefetch: jest.fn(),
      consume: jest.fn().mockImplementation((queue, cb) => {
        consumerCallback = cb;
        return Promise.resolve({ consumerTag: "tag-1" });
      }),
      ack: jest.fn(),
      nack: jest.fn(),
      sendToQueue: jest.fn().mockReturnValue(true),
    };

    (connectRabbitMQ as jest.Mock).mockResolvedValue(mockChannel);
    (assertQueueWithDLQ as jest.Mock).mockResolvedValue(undefined);
    (basketService.getCurrentBasket as jest.Mock).mockResolvedValue([
      { currency: "NGN", weight: 100 },
    ]);
  });

  it("claimTransaction updates pending transaction to processing", async () => {
    (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const result = await claimTransaction("tx-1");
    expect(result).toBe(true);
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "tx-1", status: "pending" },
      data: { status: "processing" },
    });
  });

  it("releaseClaim updates processing transaction back to pending", async () => {
    (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    await releaseClaim("tx-1");
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "tx-1", status: "processing" },
      data: { status: "pending" },
    });
  });

  it("enqueueUsdcConversion sends persistent message to queue", async () => {
    const payload: UsdcConversionPayload = {
      usdcAmount: "50",
      recipient: "GABC",
      txHash: "0x123",
    };

    await enqueueUsdcConversion(payload);

    expect(assertQueueWithDLQ).toHaveBeenCalledWith(QUEUES.USDC_CONVERSION);
    expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
      QUEUES.USDC_CONVERSION,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true },
    );
  });

  it("startUsdcConversionConsumer consumes messages and claims transaction", async () => {
    (prisma.transaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.reserveHistory.create as jest.Mock).mockResolvedValue({});
    (prisma.transaction.update as jest.Mock).mockResolvedValue({});

    const mockRouter = {
      getProvider: jest.fn().mockResolvedValue({
        convertCurrency: jest.fn().mockResolvedValue({ amount: 100, rate: 1 }),
      }),
    };
    (getFintechRouter as jest.Mock).mockReturnValue(mockRouter);

    await startUsdcConversionConsumer();

    expect(connectRabbitMQ).toHaveBeenCalled();
    expect(mockChannel.prefetch).toHaveBeenCalledWith(1);
    expect(mockChannel.consume).toHaveBeenCalled();

    const payload: UsdcConversionPayload = {
      usdcAmount: "100",
      recipient: "GABC",
      txHash: "0x123",
      transactionId: "tx-pending-1",
    };

    const msg = {
      content: Buffer.from(JSON.stringify(payload)),
      properties: { headers: {} },
    } as ConsumeMessage;

    await consumerCallback(msg);

    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { id: "tx-pending-1", status: "pending" },
      data: { status: "processing" },
    });
    expect(mockChannel.ack).toHaveBeenCalledWith(msg);
  });
});
