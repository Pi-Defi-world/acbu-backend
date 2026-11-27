import {
  parseLoanId,
  postLendingBorrow,
  postLendingRepay,
  postLendingLiquidate,
} from "../src/controllers/lendingController";
import { acbuLendingPoolService } from "../src/services/contracts";
import { getContractAddresses } from "../src/config/contracts";
import { AppError } from "../src/middleware/errorHandler";

jest.mock("../src/config/contracts", () => ({
  getContractAddresses: jest.fn(),
}));

jest.mock("../src/services/contracts", () => ({
  acbuLendingPoolService: {
    borrow: jest.fn(),
    repay: jest.fn(),
    liquidate: jest.fn(),
  },
}));

describe("Lending Controller - parseLoanId", () => {
  it("preserves numeric 0", () => {
    expect(parseLoanId(0)).toBe(0n);
  });

  it("parses string '0' as 0n", () => {
    expect(parseLoanId("0")).toBe(0n);
  });

  it("parses valid positive integer numbers and strings", () => {
    expect(parseLoanId(42)).toBe(42n);
    expect(parseLoanId("42")).toBe(42n);
    expect(parseLoanId(100n)).toBe(100n);
  });

  it("preserves large u64 decimal strings as bigint without precision loss", () => {
    const largeStr = "9007199254740992"; // Number.MAX_SAFE_INTEGER + 1
    expect(parseLoanId(largeStr)).toBe(9007199254740992n);

    const maxU64Str = "18446744073709551615";
    expect(parseLoanId(maxU64Str)).toBe(18446744073709551615n);
  });

  it("rejects null, undefined, empty, and whitespace strings", () => {
    expect(() => parseLoanId(null)).toThrow(AppError);
    expect(() => parseLoanId(undefined)).toThrow(AppError);
    expect(() => parseLoanId("")).toThrow(AppError);
    expect(() => parseLoanId("   ")).toThrow(AppError);
  });

  it("rejects non-numeric strings and floats", () => {
    expect(() => parseLoanId("abc")).toThrow(AppError);
    expect(() => parseLoanId("12.34")).toThrow(AppError);
    expect(() => parseLoanId(12.34)).toThrow(AppError);
    expect(() => parseLoanId("1e5")).toThrow(AppError);
  });

  it("rejects negative values", () => {
    expect(() => parseLoanId(-1)).toThrow(AppError);
    expect(() => parseLoanId("-1")).toThrow(AppError);
    expect(() => parseLoanId(-1n)).toThrow(AppError);
  });

  it("rejects numbers exceeding Number.MAX_SAFE_INTEGER when passed as number type", () => {
    expect(() => parseLoanId(9007199254740992)).toThrow(AppError);
  });

  it("rejects values exceeding u64 maximum (2^64 - 1)", () => {
    expect(() => parseLoanId("18446744073709551616")).toThrow(AppError);
    expect(() => parseLoanId(18446744073709551616n)).toThrow(AppError);
  });

  it("rejects boolean, array, and object types", () => {
    expect(() => parseLoanId(true)).toThrow(AppError);
    expect(() => parseLoanId(false)).toThrow(AppError);
    expect(() => parseLoanId([])).toThrow(AppError);
    expect(() => parseLoanId({})).toThrow(AppError);
  });
});

describe("Lending Controller Handlers", () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = { body: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
    (getContractAddresses as jest.Mock).mockReturnValue({
      lendingPool: "CLENDINGPOOLCONTRACTADDRESS1234567890",
    });
    jest.clearAllMocks();
  });

  describe("postLendingBorrow", () => {
    it("successfully borrows when loanId is 0", async () => {
      mockReq.body = {
        borrower: "GBORROWER123",
        lender: "GLENDER123",
        amount: "1000",
        collateralAmount: "1500",
        loanId: 0,
      };
      (acbuLendingPoolService.borrow as jest.Mock).mockResolvedValue("tx-hash-borrow");

      await postLendingBorrow(mockReq, mockRes, mockNext);

      expect(acbuLendingPoolService.borrow).toHaveBeenCalledWith({
        borrower: "GBORROWER123",
        lender: "GLENDER123",
        amount: "1000",
        collateralAmount: "1500",
        loanId: 0n,
      });
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ transaction_hash: "tx-hash-borrow" });
    });

    it("successfully borrows with large u64 loanId decimal string passed as bigint", async () => {
      mockReq.body = {
        borrower: "GBORROWER123",
        lender: "GLENDER123",
        amount: "1000",
        collateralAmount: "1500",
        loanId: "9007199254740992",
      };
      (acbuLendingPoolService.borrow as jest.Mock).mockResolvedValue("tx-hash-borrow-large");

      await postLendingBorrow(mockReq, mockRes, mockNext);

      expect(acbuLendingPoolService.borrow).toHaveBeenCalledWith({
        borrower: "GBORROWER123",
        lender: "GLENDER123",
        amount: "1000",
        collateralAmount: "1500",
        loanId: 9007199254740992n,
      });
    });

    it("rejects null or empty loanId", async () => {
      mockReq.body = {
        borrower: "GBORROWER123",
        lender: "GLENDER123",
        amount: "1000",
        collateralAmount: "1500",
        loanId: null,
      };

      await postLendingBorrow(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(acbuLendingPoolService.borrow).not.toHaveBeenCalled();
    });

    it("rejects non-integer / invalid loanId", async () => {
      mockReq.body = {
        borrower: "GBORROWER123",
        lender: "GLENDER123",
        amount: "1000",
        collateralAmount: "1500",
        loanId: "invalid",
      };

      await postLendingBorrow(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(acbuLendingPoolService.borrow).not.toHaveBeenCalled();
    });
  });

  describe("postLendingRepay", () => {
    it("successfully repays with loanId 0", async () => {
      mockReq.body = {
        borrower: "GBORROWER123",
        amount: "500",
        loanId: 0,
      };
      (acbuLendingPoolService.repay as jest.Mock).mockResolvedValue("tx-hash-repay");

      await postLendingRepay(mockReq, mockRes, mockNext);

      expect(acbuLendingPoolService.repay).toHaveBeenCalledWith({
        borrower: "GBORROWER123",
        amount: "500",
        loanId: 0n,
      });
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ transaction_hash: "tx-hash-repay" });
    });

    it("rejects null or negative loanId", async () => {
      mockReq.body = {
        borrower: "GBORROWER123",
        amount: "500",
        loanId: -1,
      };

      await postLendingRepay(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(acbuLendingPoolService.repay).not.toHaveBeenCalled();
    });
  });

  describe("postLendingLiquidate", () => {
    it("successfully liquidates with loanId as string", async () => {
      mockReq.body = {
        liquidator: "GLIQUIDATOR123",
        borrower: "GBORROWER123",
        loanId: "42",
      };
      (acbuLendingPoolService.liquidate as jest.Mock).mockResolvedValue("tx-hash-liquidate");

      await postLendingLiquidate(mockReq, mockRes, mockNext);

      expect(acbuLendingPoolService.liquidate).toHaveBeenCalledWith({
        liquidator: "GLIQUIDATOR123",
        borrower: "GBORROWER123",
        loanId: 42n,
      });
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ transaction_hash: "tx-hash-liquidate" });
    });

    it("rejects null or empty loanId", async () => {
      mockReq.body = {
        liquidator: "GLIQUIDATOR123",
        borrower: "GBORROWER123",
        loanId: "",
      };

      await postLendingLiquidate(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      expect(acbuLendingPoolService.liquidate).not.toHaveBeenCalled();
    });
  });
});
