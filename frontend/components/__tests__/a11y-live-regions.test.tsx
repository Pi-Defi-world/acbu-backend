import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RetryErrorBlock } from "@/components/ui/retry-error-block";

// W11-AUD-021: financial alerts must be announced by screen readers.
describe("live-region semantics", () => {
  it("announces destructive alerts assertively", () => {
    render(
      <Alert variant="destructive">
        <AlertDescription>Payment failed</AlertDescription>
      </Alert>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveAttribute("aria-atomic", "true");
    expect(alert).toHaveTextContent("Payment failed");
  });

  it("announces informational alerts politely as a status", () => {
    render(
      <Alert>
        <AlertDescription>Deposit confirmed</AlertDescription>
      </Alert>,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Deposit confirmed");
  });

  it("announces retryable errors assertively", () => {
    render(<RetryErrorBlock message="Transfer failed" onRetry={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });
});
