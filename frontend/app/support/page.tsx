"use client";

import { ChatMessage } from "@/components/chat/ChatMessage";
import { Card } from "@/components/ui/card";

interface SupportTicket {
  ticketId: string;
  subject: string;
  message: string;
  name: string;
  createdAt: string;
}

// Example usage showing how to render support ticket content safely.
// All user-generated fields (subject, message, name) are rendered as
// plain text nodes — never via dangerouslySetInnerHTML.
export default function SupportTicketPage({
  ticket,
}: {
  ticket?: SupportTicket;
}) {
  if (!ticket) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <p className="text-muted-foreground">No ticket selected.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Card className="p-6 space-y-4">
        <h1 className="text-xl font-semibold">
          {/* Plain text — no XSS risk */}
          <ChatMessage content={ticket.subject} />
        </h1>

        <p className="text-xs text-muted-foreground">
          From <span className="font-medium">{ticket.name}</span> ·{" "}
          {new Date(ticket.createdAt).toLocaleString()}
        </p>

        <div className="border-t border-border pt-4">
          {/* Plain text — no XSS risk */}
          <ChatMessage content={ticket.message} className="whitespace-pre-wrap text-sm" />
        </div>
      </Card>
    </div>
  );
}
