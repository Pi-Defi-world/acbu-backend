import { assertUserWalletAddress } from "./walletService";
import { prisma } from "../../config/database";
import { AppError } from "../../middleware/errorHandler";

jest.mock("../../config/database", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

const mockedFindUnique = prisma.user.findUnique as jest.Mock;

describe("walletService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the user wallet address when it matches the provided address", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" });
    const result = await assertUserWalletAddress(
      "user-1",
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    );
    expect(result).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    expect(mockedFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { stellarAddress: true },
    });
  });

  it("throws 400 when the user has no wallet address", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: null });
    await expect(
      assertUserWalletAddress("user-2", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"),
    ).rejects.toMatchObject({ statusCode: 400, message: "User wallet address not set" });
  });

  it("throws 403 when the provided address does not match the user's wallet", async () => {
    mockedFindUnique.mockResolvedValue({ stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" });
    await expect(
      assertUserWalletAddress("user-3", "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
    ).rejects.toMatchObject({ statusCode: 403, message: "Wallet address does not match user" });
  });
});
