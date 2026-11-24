import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OAuthCallbackPage from "./page";
import * as authApi from "@/lib/api/auth";
import * as authContext from "@/contexts/auth-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
  useSearchParams: vi.fn(),
}));

vi.mock("@/contexts/auth-context");
vi.mock("@/lib/api/auth");
vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe("OAuthCallbackPage", () => {
  const mockLogin = vi.fn();
  const mockReplace = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();

    // Mock auth context
    vi.mocked(authContext.useAuth).mockReturnValue({
      userId: null,
      stellarAddress: null,
      isAuthenticated: false,
      isHydrated: true,
      login: mockLogin,
      logout: vi.fn(),
      setAuth: vi.fn(),
      refreshStellarAddress: vi.fn(),
    });

    // Mock router
    const { useRouter } = require("next/navigation");
    useRouter.mockReturnValue({
      replace: mockReplace,
    });
  });

  it("successfully exchanges OAuth code and redirects after login", async () => {
    // Setup
    sessionStorage.setItem("oauth_state", "test-state");
    sessionStorage.setItem("oauth_return_path", "/dashboard");

    const { useSearchParams } = require("next/navigation");
    useSearchParams.mockReturnValue(
      new URLSearchParams({
        code: "test-code",
        state: "test-state",
      })
    );

    vi.mocked(authApi.exchangeOAuthCode).mockResolvedValue({
      user_id: "user-123",
      stellar_address: "GABC123XYZ",
    });

    render(<OAuthCallbackPage />);

    // Verify code exchange was called
    await waitFor(() => {
      expect(authApi.exchangeOAuthCode).toHaveBeenCalledWith("test-code", "test-state");
    });

    // Verify login was called with credentials
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith("user-123", "GABC123XYZ");
    });

    // Verify redirect happened
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/dashboard");
    });

    // Verify state was cleaned up
    expect(sessionStorage.getItem("oauth_state")).toBeNull();
    expect(sessionStorage.getItem("oauth_return_path")).toBeNull();

    // Verify success message is shown
    expect(screen.getByText(/Signed in successfully/i)).toBeInTheDocument();
  });

  it("shows error when authorization code is missing", async () => {
    sessionStorage.setItem("oauth_state", "test-state");

    const { useSearchParams } = require("next/navigation");
    useSearchParams.mockReturnValue(
      new URLSearchParams({
        state: "test-state",
      })
    );

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByText(/Missing authorization code/i)).toBeInTheDocument();
    });

    // Verify code exchange was NOT called
    expect(authApi.exchangeOAuthCode).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows error when state parameter is invalid", async () => {
    sessionStorage.setItem("oauth_state", "stored-state");

    const { useSearchParams } = require("next/navigation");
    useSearchParams.mockReturnValue(
      new URLSearchParams({
        code: "test-code",
        state: "different-state",
      })
    );

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByText(/Invalid state parameter/i)).toBeInTheDocument();
    });

    // Verify code exchange was NOT called
    expect(authApi.exchangeOAuthCode).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows error when code exchange fails", async () => {
    sessionStorage.setItem("oauth_state", "test-state");

    const { useSearchParams } = require("next/navigation");
    useSearchParams.mockReturnValue(
      new URLSearchParams({
        code: "test-code",
        state: "test-state",
      })
    );

    const error = new Error("Code exchange failed");
    vi.mocked(authApi.exchangeOAuthCode).mockRejectedValue(error);

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByText(/Authorization failed/i)).toBeInTheDocument();
    });

    // Verify login was NOT called
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("shows error when code exchange returns invalid response (missing user_id)", async () => {
    sessionStorage.setItem("oauth_state", "test-state");

    const { useSearchParams } = require("next/navigation");
    useSearchParams.mockReturnValue(
      new URLSearchParams({
        code: "test-code",
        state: "test-state",
      })
    );

    vi.mocked(authApi.exchangeOAuthCode).mockResolvedValue({
      user_id: "", // Invalid: empty user_id
      stellar_address: "GABC123XYZ",
    });

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(screen.getByText(/Authentication failed/i)).toBeInTheDocument();
    });

    // Verify login was NOT called
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects to default path when oauth_return_path is not set", async () => {
    sessionStorage.setItem("oauth_state", "test-state");
    // Note: oauth_return_path is NOT set

    const { useSearchParams } = require("next/navigation");
    useSearchParams.mockReturnValue(
      new URLSearchParams({
        code: "test-code",
        state: "test-state",
      })
    );

    vi.mocked(authApi.exchangeOAuthCode).mockResolvedValue({
      user_id: "user-123",
      stellar_address: "GABC123XYZ",
    });

    render(<OAuthCallbackPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });
});
