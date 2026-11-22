import { NextRequest, NextResponse } from 'next/server';

type SupportTicketInput = {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
  page?: string;
};

type SupportTicketPayload = {
  ticketId: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  page: string;
  userAgent: string | null;
  createdAt: string;
};

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function makeTicketId(): string {
  return `SUP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: SupportTicketInput;

  try {
    body = (await request.json()) as SupportTicketInput;
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.' },
      { status: 400 },
    );
  }

  const name = trimText(body.name);
  const email = trimText(body.email);
  const subject = trimText(body.subject);
  const message = trimText(body.message);
  const page = trimText(body.page) || '/help';

  if (!name || !email || !subject || !message) {
    return NextResponse.json(
      { error: 'Name, email, subject, and message are required.' },
      { status: 400 },
    );
  }

  if (subject.length > 120 || message.length > 4000) {
    return NextResponse.json(
      { error: 'Subject or message is too long.' },
      { status: 400 },
    );
  }

  const ticketId = makeTicketId();
  const payload: SupportTicketPayload = {
    ticketId,
    name,
    email,
    subject,
    message,
    page,
    userAgent: request.headers.get('user-agent'),
    createdAt: new Date().toISOString(),
  };

  const intakeUrl =
    process.env.SUPPORT_INTAKE_URL?.trim() ??
    process.env.NEXT_PUBLIC_SUPPORT_INTAKE_URL?.trim() ??
    '';

  if (!intakeUrl) {
    console.warn(
      '[Support] No support intake configured. Ticket not forwarded.',
      JSON.stringify(payload, null, 2),
    );

    return NextResponse.json(
      {
        error:
          'Support intake is not configured. Please contact support@acbu.io directly.',
      },
      { status: 503 },
    );
  }

  let parsedIntakeUrl: URL;
  try {
    parsedIntakeUrl = new URL(intakeUrl);
  } catch {
    console.error('[Support] SUPPORT_INTAKE_URL is not a valid URL:', intakeUrl);
    return NextResponse.json(
      { error: 'Support intake is misconfigured. Please contact support@acbu.io directly.' },
      { status: 503 },
    );
  }

  if (parsedIntakeUrl.protocol !== 'https:') {
    console.error('[Support] SUPPORT_INTAKE_URL must use HTTPS:', intakeUrl);
    return NextResponse.json(
      { error: 'Support intake is misconfigured. Please contact support@acbu.io directly.' },
      { status: 503 },
    );
  }

  const forwardResponse = await fetch(parsedIntakeUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!forwardResponse.ok) {
    return NextResponse.json(
      {
        error: 'Support intake rejected the request.',
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      ticketId,
      status: 'queued',
    },
    { status: 202 },
  );
}
