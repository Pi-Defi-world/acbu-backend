import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const ticket = {
  name: " Ada Lovelace ",
  email: "ada@example.com",
  subject: "Cannot access my wallet",
  message: "Please help me restore access.",
  page: "/help",
};

function makeRequest(body: unknown) {
  return new NextRequest("https://app.example.com/api/support", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "support-form-test",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/support", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SUPPORT_INTAKE_URL", "https://support.example.com/tickets");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_INTAKE_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("forwards the ticket and returns a queued response only after intake accepts it", async () => {
    fetchMock.mockResolvedValue({ ok: true });

    const response = await POST(makeRequest(ticket));
    const result = await response.json();
    const [intakeUrl, requestInit] = fetchMock.mock.calls[0];
    const forwardedTicket = JSON.parse(requestInit.body as string);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(intakeUrl).toBe("https://support.example.com/tickets");
    expect(requestInit.method).toBe("POST");
    expect(forwardedTicket).toMatchObject({
      ...ticket,
      name: "Ada Lovelace",
      userAgent: "support-form-test",
    });
    expect(forwardedTicket.ticketId).toMatch(/^SUP-/);
    expect(response.status).toBe(202);
    expect(result).toMatchObject({
      ticketId: forwardedTicket.ticketId,
      status: "queued",
    });
  });

  it("returns an explicit unavailable error without forwarding when intake is not configured", async () => {
    vi.stubEnv("SUPPORT_INTAKE_URL", "");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await POST(makeRequest(ticket));
    const result = await response.json();

    expect(response.status).toBe(503);
    expect(result.error).toContain("Support intake is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("returns a gateway error when the configured intake rejects the ticket", async () => {
    fetchMock.mockResolvedValue({ ok: false });

    const response = await POST(makeRequest(ticket));
    const result = await response.json();

    expect(response.status).toBe(502);
    expect(result.error).toBe("Support intake rejected the request.");
    expect(result.ticketId).toBeUndefined();
  });
});
