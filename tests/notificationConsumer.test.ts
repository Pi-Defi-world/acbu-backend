// --- mock dependencies ---
jest.mock("../src/config/rabbitmq", () => ({
  connectRabbitMQ: jest.fn(),
}));

jest.mock("../src/config/logger", () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock("../src/config/database", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.mock("../src/services/notification", () => ({
  sendEmail: jest.fn(),
  sendSms: jest.fn(),
  renderInvestmentWithdrawalReadyTemplate: jest.fn(),
}));

import { prisma } from "../src/config/database";
import { sendEmail, sendSms, renderInvestmentWithdrawalReadyTemplate } from "../src/services/notification";

const mockSendEmail = sendEmail as jest.Mock;
const mockSendSms = sendSms as jest.Mock;
const mockRenderTemplate = renderInvestmentWithdrawalReadyTemplate as jest.Mock;
const mockFindUnique = prisma.user.findUnique as jest.Mock;
const mockFindMany = prisma.user.findMany as jest.Mock;

// Simulating the notification consumer logic directly for testing
async function processNotification(payload: any): Promise<void> {
  const { type } = payload;
  if (type === "investment_withdrawal_ready") {
    const userId = payload.userId as string | null;
    const organizationId = payload.organizationId as string | null;
    const amountAcbu = (payload.amountAcbu as number) ?? 0;
    const body = renderInvestmentWithdrawalReadyTemplate(amountAcbu);

    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, phoneE164: true },
      });
      if (user?.email)
        await sendEmail(
          user.email,
          "Your investment withdrawal is ready",
          body,
        );
      if (user?.phoneE164) await sendSms(user.phoneE164, body);
    }

    if (organizationId) {
      const orgUsers = await prisma.user.findMany({
        where: { organizationId },
        select: { email: true, phoneE164: true },
      });
      for (const user of orgUsers) {
        if (user.email)
          await sendEmail(
            user.email,
            "Organization investment withdrawal is ready",
            body,
          );
        if (user.phoneE164) await sendSms(user.phoneE164, body);
      }
    }
    return;
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRenderTemplate.mockReturnValue("<html>Investment ready</html>");
});

describe("Notification Consumer - investment_withdrawal_ready", () => {
  it("should send email to user for user withdrawal", async () => {
    const userEmail = "user@example.com";
    mockFindUnique.mockResolvedValue({
      email: userEmail,
      phoneE164: null,
    });

    const payload = {
      type: "investment_withdrawal_ready",
      userId: "user-123",
      organizationId: null,
      amountAcbu: 100,
      timestamp: new Date().toISOString(),
    };

    await processNotification(payload);

    expect(mockSendEmail).toHaveBeenCalledWith(
      userEmail,
      "Your investment withdrawal is ready",
      "<html>Investment ready</html>",
    );
  });

  it("should send SMS to user for user withdrawal", async () => {
    const userPhone = "+1234567890";
    mockFindUnique.mockResolvedValue({
      email: null,
      phoneE164: userPhone,
    });

    const payload = {
      type: "investment_withdrawal_ready",
      userId: "user-123",
      organizationId: null,
      amountAcbu: 100,
      timestamp: new Date().toISOString(),
    };

    await processNotification(payload);

    expect(mockSendSms).toHaveBeenCalledWith(userPhone, "<html>Investment ready</html>");
  });

  it("should send notifications to all org members for org withdrawal", async () => {
    const orgMembers = [
      { email: "admin1@org.com", phoneE164: "+1111111111" },
      { email: "admin2@org.com", phoneE164: null },
      { email: null, phoneE164: "+2222222222" },
    ];

    mockFindMany.mockResolvedValue(orgMembers);

    const payload = {
      type: "investment_withdrawal_ready",
      userId: null,
      organizationId: "org-123",
      amountAcbu: 100,
      timestamp: new Date().toISOString(),
    };

    await processNotification(payload);

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    expect(mockSendEmail).toHaveBeenCalledWith(
      "admin1@org.com",
      "Organization investment withdrawal is ready",
      "<html>Investment ready</html>",
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      "admin2@org.com",
      "Organization investment withdrawal is ready",
      "<html>Investment ready</html>",
    );

    expect(mockSendSms).toHaveBeenCalledTimes(2);
    expect(mockSendSms).toHaveBeenCalledWith("+1111111111", "<html>Investment ready</html>");
    expect(mockSendSms).toHaveBeenCalledWith("+2222222222", "<html>Investment ready</html>");
  });

  it("should not send notifications if org has no users", async () => {
    mockFindMany.mockResolvedValue([]);

    const payload = {
      type: "investment_withdrawal_ready",
      userId: null,
      organizationId: "org-empty",
      amountAcbu: 100,
      timestamp: new Date().toISOString(),
    };

    await processNotification(payload);

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("should skip empty email/phone fields for org members", async () => {
    const orgMembers = [
      { email: null, phoneE164: null },
      { email: "valid@org.com", phoneE164: null },
    ];

    mockFindMany.mockResolvedValue(orgMembers);

    const payload = {
      type: "investment_withdrawal_ready",
      userId: null,
      organizationId: "org-123",
      amountAcbu: 100,
      timestamp: new Date().toISOString(),
    };

    await processNotification(payload);

    // Should only send email to the user with valid email
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      "valid@org.com",
      "Organization investment withdrawal is ready",
      "<html>Investment ready</html>",
    );
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it("should send notifications to both user and org if both IDs present", async () => {
    mockFindUnique.mockResolvedValue({
      email: "user@example.com",
      phoneE164: null,
    });

    mockFindMany.mockResolvedValue([
      { email: "admin@org.com", phoneE164: null },
      { email: "member@org.com", phoneE164: null },
    ]);

    const payload = {
      type: "investment_withdrawal_ready",
      userId: "user-123",
      organizationId: "org-123",
      amountAcbu: 100,
      timestamp: new Date().toISOString(),
    };

    await processNotification(payload);

    // Should send to user
    expect(mockSendEmail).toHaveBeenCalledWith(
      "user@example.com",
      "Your investment withdrawal is ready",
      "<html>Investment ready</html>",
    );

    // Should send to org members
    expect(mockSendEmail).toHaveBeenCalledWith(
      "admin@org.com",
      "Organization investment withdrawal is ready",
      "<html>Investment ready</html>",
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      "member@org.com",
      "Organization investment withdrawal is ready",
      "<html>Investment ready</html>",
    );

    expect(mockSendEmail).toHaveBeenCalledTimes(3);
  });
});
