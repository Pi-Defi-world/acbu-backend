import { getHealthReport } from "../src/services/health/healthService";

// --- mock dependencies ---
jest.mock("../src/config/database", () => ({
  prisma: { $queryRaw: jest.fn() },
}));

jest.mock("../src/config/mongodb", () => ({
  getMongoDB: jest.fn(),
}));

jest.mock("../src/config/rabbitmq", () => ({
  getRabbitMQChannel: jest.fn(),
}));

jest.mock("../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { prisma } from "../src/config/database";
import { getMongoDB } from "../src/config/mongodb";
import { getRabbitMQChannel } from "../src/config/rabbitmq";

const mockPrismaQuery = prisma.$queryRaw as jest.Mock;
const mockGetMongoDB = getMongoDB as jest.Mock;
const mockGetRabbitMQChannel = getRabbitMQChannel as jest.Mock;

// Helper: fake Mongo db with working ping
const healthyMongo = () => ({
  admin: () => ({ ping: jest.fn().mockResolvedValue({ ok: 1 }) }),
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getHealthReport", () => {
  it("should return status 'up' when all dependencies are healthy", async () => {
    mockPrismaQuery.mockResolvedValue([{ "?column?": 1 }]);
    mockGetMongoDB.mockReturnValue(healthyMongo());
    mockGetRabbitMQChannel.mockReturnValue({ /* non-null channel */ ack: jest.fn() });

    const report = await getHealthReport();

    expect(report.status).toBe("up");
    expect(report.details.postgres.status).toBe("up");
    expect(report.details.mongodb.status).toBe("up");
    expect(report.details.rabbitmq.status).toBe("up");
  });

  it("should return 503-worthy status 'down' when PostgreSQL connection is lost", async () => {
    mockPrismaQuery.mockRejectedValue(new Error("ECONNREFUSED"));
    mockGetMongoDB.mockReturnValue(healthyMongo());
    mockGetRabbitMQChannel.mockReturnValue({ ack: jest.fn() });

    const report = await getHealthReport();

    expect(report.status).toBe("down");
    expect(report.details.postgres.status).toBe("down");
    expect(report.details.postgres.error).toBe("PostgreSQL unreachable");
    // other services still up
    expect(report.details.mongodb.status).toBe("up");
    expect(report.details.rabbitmq.status).toBe("up");
  });

  it("should return status 'down' when MongoDB is unreachable", async () => {
    mockPrismaQuery.mockResolvedValue([{ "?column?": 1 }]);
    mockGetMongoDB.mockImplementation(() => {
      throw new Error("MongoDB not connected");
    });
    mockGetRabbitMQChannel.mockReturnValue({ ack: jest.fn() });

    const report = await getHealthReport();

    expect(report.status).toBe("down");
    expect(report.details.mongodb.status).toBe("down");
  });

  it("should return status 'down' when RabbitMQ channel is unavailable", async () => {
    mockPrismaQuery.mockResolvedValue([{ "?column?": 1 }]);
    mockGetMongoDB.mockReturnValue(healthyMongo());
    mockGetRabbitMQChannel.mockReturnValue(null);

    const report = await getHealthReport();

    expect(report.status).toBe("down");
    expect(report.details.rabbitmq.status).toBe("down");
  });

  it("should include timestamp and uptime in the report", async () => {
    mockPrismaQuery.mockResolvedValue([{ "?column?": 1 }]);
    mockGetMongoDB.mockReturnValue(healthyMongo());
    mockGetRabbitMQChannel.mockReturnValue({ ack: jest.fn() });

    const report = await getHealthReport();

    expect(report.timestamp).toBeDefined();
    expect(typeof report.uptime).toBe("number");
  });
});
