import type { FintechProvider } from "./types";
import { FintechProviderRouter } from "./router";

function makeProvider(balance: () => Promise<number>): FintechProvider {
  return {
    getBalance: jest.fn(balance),
    convertCurrency: jest.fn(),
    disburseFunds: jest.fn(),
  };
}

describe("FintechProviderRouter", () => {
  it("uses configured priority and falls back when a provider is unhealthy", async () => {
    const router = new FintechProviderRouter({ NGN: ["paystack", "flutterwave"] });
    const unhealthyProvider = makeProvider(() => Promise.reject(new Error("offline")));
    const healthyProvider = makeProvider(() => Promise.resolve(100));
    router.register("paystack", unhealthyProvider);
    router.register("flutterwave", healthyProvider);

    await expect(router.getProvider("NGN")).resolves.toBe(healthyProvider);
    expect(unhealthyProvider.getBalance).toHaveBeenCalledWith("NGN");
    expect(healthyProvider.getBalance).toHaveBeenCalledWith("NGN");
  });
});
