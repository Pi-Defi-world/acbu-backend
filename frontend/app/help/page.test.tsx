import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HelpPage from "./page";

const fetchMock = vi.fn();

function fillContactForm() {
  fireEvent.change(screen.getByPlaceholderText("Your name"), {
    target: { value: "Ada Lovelace" },
  });
  fireEvent.change(screen.getByPlaceholderText("your@email.com"), {
    target: { value: "ada@example.com" },
  });
  fireEvent.change(screen.getByPlaceholderText("What do you need help with?"), {
    target: { value: "Cannot access my wallet" },
  });
  fireEvent.change(
    screen.getByPlaceholderText("Describe your issue in detail..."),
    {
      target: { value: "Please help me restore access." },
    },
  );
}

describe("HelpPage contact form", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the support request and confirms the queued ticket", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi
        .fn()
        .mockResolvedValue({ ticketId: "SUP-123", status: "queued" }),
    });

    render(<HelpPage />);
    fillContactForm();
    fireEvent.click(screen.getByRole("button", { name: "Send Message" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/support",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Ada Lovelace",
            email: "ada@example.com",
            subject: "Cannot access my wallet",
            message: "Please help me restore access.",
            page: "/help",
          }),
        }),
      );
    });

    expect(
      await screen.findByText("Message sent successfully!"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Ticket SUP-123 has been queued for support."),
    ).toBeInTheDocument();
  });

  it("shows a failure instead of success when support intake rejects the request", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: vi
        .fn()
        .mockResolvedValue({ error: "Support intake is unavailable." }),
    });

    render(<HelpPage />);
    fillContactForm();
    fireEvent.click(screen.getByRole("button", { name: "Send Message" }));

    expect(
      await screen.findByText("We could not send your message."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Support intake is unavailable."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Message sent successfully!"),
    ).not.toBeInTheDocument();
  });
});
