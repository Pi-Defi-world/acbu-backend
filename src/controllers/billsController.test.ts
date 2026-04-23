import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../middleware/auth";
import {
  getBillsCatalog,
  postBillsPay,
  postBillsRefund,
} from "./billsController";

jest.mock("../services/bills", () => ({
  getBillsCatalog: jest.fn(),
  payBill: jest.fn(),
  refundBillPayment: jest.fn(),
}));

jest.mock("../config/logger", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import {
  getBillsCatalog as fetchBillsCatalog,
  payBill,
  refundBillPayment,
} from "../services/bills";

const makeRes = () => {
  const res = { status: jest.fn(), json: jest.fn() } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  (res.json as jest.Mock).mockReturnValue(res);
  return res;
};

const makeNext = () => jest.fn() as jest.MockedFunction<NextFunction>;

describe("billsController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the bills catalog", async () => {
    (fetchBillsCatalog as jest.Mock).mockResolvedValue({
      provider: "simulated",
      billers: [{ id: "ikeja-electric" }],
    });
    const res = makeRes();

    await getBillsCatalog({} as AuthRequest, res, makeNext());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      provider: "simulated",
      billers: [{ id: "ikeja-electric" }],
    });
  });

  it("rejects invalid bill payment payloads with a 400", async () => {
    const next = makeNext();

    await postBillsPay(
      {
        apiKey: { userId: "user-1", organizationId: null },
        body: {
          biller_id: "ikeja-electric",
          product_id: "prepaid",
          customer_reference: "bad ref!",
          amount: -5,
        },
      } as unknown as AuthRequest,
      makeRes(),
      next,
    );

    expect((next as jest.Mock).mock.calls[0][0]).toMatchObject({
      statusCode: 400,
    });
  });

  it("creates a bill payment on the happy path", async () => {
    (payBill as jest.Mock).mockResolvedValue({
      transactionId: "tx-1",
      status: "completed",
      provider: "simulated",
      providerReference: "bill-ref-1",
      billerId: "ikeja-electric",
      productId: "prepaid",
      localAmount: 5000,
      currency: "NGN",
      reconciled: true,
    });
    const res = makeRes();

    await postBillsPay(
      {
        apiKey: { userId: "user-1", organizationId: null },
        body: {
          biller_id: "ikeja-electric",
          product_id: "prepaid",
          customer_reference: "12345678901",
          amount: 5000,
        },
      } as unknown as AuthRequest,
      res,
      makeNext(),
    );

    expect(payBill).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        billerId: "ikeja-electric",
        productId: "prepaid",
        customerReference: "12345678901",
        amount: 5000,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      transaction_id: "tx-1",
      status: "completed",
      provider: "simulated",
      provider_reference: "bill-ref-1",
      biller_id: "ikeja-electric",
      product_id: "prepaid",
      amount: 5000,
      currency: "NGN",
      reconciled: true,
    });
  });

  it("refunds a completed bill payment", async () => {
    (refundBillPayment as jest.Mock).mockResolvedValue({
      transactionId: "tx-1",
      provider: "simulated",
      providerReference: "bill-ref-1",
      status: "refunded",
    });
    const res = makeRes();

    await postBillsRefund(
      {
        apiKey: { userId: "user-1", organizationId: null },
        body: {
          transaction_id: "7f7f8b7b-9d39-44b9-8ff1-532816c2f22b",
          reason: "duplicate payment",
        },
      } as unknown as AuthRequest,
      res,
      makeNext(),
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      transaction_id: "tx-1",
      status: "refunded",
      provider: "simulated",
      provider_reference: "bill-ref-1",
    });
  });
});
