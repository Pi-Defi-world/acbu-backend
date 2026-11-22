import { fireEvent, render, screen, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../auth-context";
import { clearRatesCache } from "@/hooks/use-rates";
import { clearConfigCache } from "@/hooks/use-config";

vi.mock("@/lib/api/user", () => ({
  getMe: vi.fn().mockRejectedValue({ status: 401 }),
}));

vi.mock("@/lib/api/auth", () => ({
  signout: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/hooks/use-rates", () => ({
  clearRatesCache: vi.fn(),
}));

vi.mock("@/hooks/use-config", () => ({
  clearConfigCache: vi.fn(),
}));

function AuthHarness() {
  const { userId, stellarAddress, isAuthenticated, login, logout } = useAuth();

  return (
    <div>
      <div data-testid="user-id">{userId ?? "null"}</div>
      <div data-testid="stellar-address">{stellarAddress ?? "null"}</div>
      <div data-testid="is-authenticated">{String(isAuthenticated)}</div>
      <button type="button" onClick={() => login("user-1", "GABC123")}>
        login
      </button>
      <button type="button" onClick={() => logout()}>
        logout
      </button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("stores the supplied user id and stellar address when login is called", async () => {
    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /login/i }));

    expect(await screen.findByTestId("user-id")).toHaveTextContent("user-1");
    expect(screen.getByTestId("stellar-address")).toHaveTextContent("GABC123");
    expect(screen.getByTestId("is-authenticated")).toHaveTextContent("true");
    expect(sessionStorage.getItem("acbu_user_id")).toBe("user-1");
    expect(sessionStorage.getItem("acbu_stellar_address")).toBe("GABC123");
    expect(clearRatesCache).toHaveBeenCalled();
    expect(clearConfigCache).toHaveBeenCalled();
  });

  it("invalidates rates and config caches on logout", async () => {
    render(
      <AuthProvider>
        <AuthHarness />
      </AuthProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /login/i }));
    vi.clearAllMocks();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /logout/i }));
    });

    expect(clearRatesCache).toHaveBeenCalled();
    expect(clearConfigCache).toHaveBeenCalled();
  });
});
