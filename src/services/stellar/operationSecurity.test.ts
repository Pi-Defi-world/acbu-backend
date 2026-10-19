import { validateOperationsForTreasuryAccount, isTreasuryAccount } from "./operationSecurity";

describe("operationSecurity", () => {
  const treasuryAccountId = "GDZST3XVCDTUJ76ZAV2HA72KYLT5FGZD5G6N7NZ6XHFWLQDN5SWTB24F";
  const otherAccountId = "GBXDIBFH4ZRXO3KSQXQJIBQQFQULWIKFKFH4DBGFWJDX6GWVDGXC5X3";

  describe("validateOperationsForTreasuryAccount", () => {
    it("should allow safe operations for treasury account", () => {
      const operations: any[] = [
        { type: "payment", destination: otherAccountId, amount: "100" },
        { type: "createAccount", destination: otherAccountId, startingBalance: "10" },
      ];

      expect(() =>
        validateOperationsForTreasuryAccount(operations, treasuryAccountId, treasuryAccountId),
      ).not.toThrow();
    });

    it("should reject accountMerge operations for treasury account", () => {
      const operations: any[] = [{ type: "accountMerge", destination: otherAccountId }];

      expect(() =>
        validateOperationsForTreasuryAccount(operations, treasuryAccountId, treasuryAccountId),
      ).toThrow(
        "Operation 'accountMerge' is forbidden for the treasury account to prevent asset drainage attacks",
      );
    });

    it("should allow all operations for non-treasury accounts", () => {
      const operations: any[] = [{ type: "accountMerge", destination: treasuryAccountId }];

      expect(() =>
        validateOperationsForTreasuryAccount(operations, otherAccountId, treasuryAccountId),
      ).not.toThrow();
    });

  it("should allow operations when no treasury account is configured", () => {
    const operations: any[] = [{ type: "accountMerge", destination: otherAccountId }];

    expect(() =>
      validateOperationsForTreasuryAccount(operations, treasuryAccountId, ""),
    ).not.toThrow();
  });

  // ── Operation-type allow-list (Pi-Defi-world/acbu-backend#983) ────────────

  it("rejects operation types that are not on the treasury allow-list", () => {
    const operations: any[] = [
      { type: "manageData", name: "backdoor", value: "x" },
    ];

    expect(() =>
      validateOperationsForTreasuryAccount(operations, treasuryAccountId, treasuryAccountId),
    ).toThrow(
      "Operation 'manageData' is not allowed for the treasury account: only allow-listed operation types may be executed",
    );
  });

  it("rejects accountMerge as a non-allow-listed type with the legacy message", () => {
    const operations: any[] = [{ type: "accountMerge", destination: otherAccountId }];

    expect(() =>
      validateOperationsForTreasuryAccount(operations, treasuryAccountId, treasuryAccountId),
    ).toThrow(
      "Operation 'accountMerge' is forbidden for the treasury account to prevent asset drainage attacks",
    );
  });

  it("allows allow-listed operation types for treasury", () => {
    const operations: any[] = [
      { type: "payment", destination: otherAccountId, amount: "100" },
      { type: "changeTrust", line: { code: "USDC" }, limit: "1000000" },
      { type: "setOptions", lowThreshold: 1 },
      { type: "bumpSequence", bumpTo: 100 },
    ];

    expect(() =>
      validateOperationsForTreasuryAccount(operations, treasuryAccountId, treasuryAccountId),
    ).not.toThrow();
  });

  // ── Destination allow-list (Pi-Defi-world/acbu-backend#983) ───────────────

  describe("destination allow-list", () => {
    const approved = "GA" + "B".repeat(54);
    const unapproved = "GA" + "C".repeat(54);

    beforeEach(() => {
      process.env.TREASURY_ALLOWED_DESTINATIONS = approved;
    });

    afterEach(() => {
      delete process.env.TREASURY_ALLOWED_DESTINATIONS;
    });

    it("rejects payment to a destination that is not allow-listed", () => {
      const operations: any[] = [
        { type: "payment", destination: unapproved, amount: "100" },
      ];

      expect(() =>
        validateOperationsForTreasuryAccount(operations, treasuryAccountId, treasuryAccountId),
      ).toThrow(
        `Treasury operation destination '${unapproved}' is not on the approved destination allow-list`,
      );
    });

    it("allows payments to allow-listed destinations", () => {
      const operations: any[] = [
        { type: "payment", destination: approved, amount: "100" },
      ];

      expect(() =>
        validateOperationsForTreasuryAccount(operations, treasuryAccountId, treasuryAccountId),
      ).not.toThrow();
    });

    it("always allows payments back to the treasury itself", () => {
      const operations: any[] = [
        { type: "payment", destination: treasuryAccountId, amount: "100" },
      ];

      expect(() =>
        validateOperationsForTreasuryAccount(operations, treasuryAccountId, treasuryAccountId),
      ).not.toThrow();
    });

    it("rejects createAccount to unapproved destinations", () => {
      const operations: any[] = [
        { type: "createAccount", destination: unapproved, startingBalance: "10" },
      ];

      expect(() =>
        validateOperationsForTreasuryAccount(operations, treasuryAccountId, treasuryAccountId),
      ).toThrow("not on the approved destination allow-list");
    });
  });
});

  describe("isTreasuryAccount", () => {
    it("should identify treasury account correctly", () => {
      expect(isTreasuryAccount(treasuryAccountId, treasuryAccountId)).toBe(true);
    });

    it("should identify non-treasury account correctly", () => {
      expect(isTreasuryAccount(otherAccountId, treasuryAccountId)).toBe(false);
    });
  });
});
