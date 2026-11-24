"use client";

import { useMemo } from "react";
import { sanitizeHtml } from "@/lib/sanitize";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  content: string;
  /** When true, content is rendered as plain text (default). Set to true only for trusted rich-text from the server. */
  isHtml?: boolean;
  className?: string;
}

/**
 * Renders a chat message. User-generated HTML is always sanitized via DOMPurify
 * before being passed to dangerouslySetInnerHTML. Plain-text content is rendered
 * as text nodes, never as HTML.
 */
export function ChatMessage({ content, isHtml = false, className }: ChatMessageProps) {
  const sanitized = useMemo(() => (isHtml ? sanitizeHtml(content) : null), [content, isHtml]);

  return (
    <div className={cn("chat-message break-words", className)}>
      {isHtml && sanitized !== null ? (
        <span dangerouslySetInnerHTML={{ __html: sanitized }} />
      ) : (
        <span>{content}</span>
      )}
    </div>
  );
}
