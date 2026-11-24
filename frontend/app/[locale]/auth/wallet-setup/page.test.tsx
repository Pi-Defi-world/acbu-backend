import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WalletSetupPage from "./page";
import * as authContext from "@/contexts/auth-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/contexts/auth-context");

vi.mock("@/lib/passcode-manager", () => ({
  getPasscode: () => "test-passcode",
}));

vi.mock("@/lib/stellar-wallets-kit", () => ({
  useStellarWalletsKit: () => ({ openModal: vi.fn() }),
}));

describe("WalletSetupPage", () => {
  beforeEach(() => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      userId: "user-1",
      stellarAddress: null,
      isAuthenticated: true,
      isHydrated: true,
      login: vi.fn(),
      logout: vi.fn(),
      setAuth: vi.fn(),
      refreshStellarAddress: vi.fn(),
    });
  });

  it("renders wallet setup choices in a dialog", async () => {
    render(<WalletSetupPage />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Set Up Your Wallet" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Generate New Wallet/ })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Import Existing Seed/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect External Wallet/ })).toBeInTheDocument();
  });
});