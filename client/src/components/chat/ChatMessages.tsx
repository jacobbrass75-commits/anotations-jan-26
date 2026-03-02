import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, Lightbulb, FileText, PenLine } from "lucide-react";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { DocumentCard } from "./DocumentCard";
import type { Message } from "@shared/schema";
import type { ToolStatus } from "@/hooks/useChat";

interface ChatMessagesProps {
  messages: Message[];
  streamingText: string;
  isStreaming: boolean;
  activeToolStatus?: ToolStatus | null;
  onSuggestedPrompt?: (prompt: string) => void;
}

const SUGGESTED_PROMPTS = [
  {
    icon: BookOpen,
    label: "Help me understand a concept",
    prompt: "Can you explain the concept of peer review in academic publishing?",
  },
  {
    icon: PenLine,
    label: "Improve my writing",
    prompt: "Can you help me improve the clarity and flow of my thesis introduction?",
  },
  {
    icon: FileText,
    label: "Format a citation",
    prompt: "How do I cite a journal article in Chicago style?",
  },
  {
    icon: Lightbulb,
    label: "Research methodology",
    prompt: "What are the differences between qualitative and quantitative research methods?",
  },
];

// Parse message content to extract <document> tags and regular text
function parseMessageContent(
  content: string
): Array<{ type: "text"; text: string } | { type: "document"; title: string; content: string }> {
  const parts: Array<
    { type: "text"; text: string } | { type: "document"; title: string; content: string }
  > = [];
  const docRegex = /<document\s+title="([^"]*)">([\s\S]*?)<\/document>/g;
  let lastIndex = 0;
  let match;

  while ((match = docRegex.exec(content)) !== null) {
    // Add text before this document tag
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) {
        parts.push({ type: "text", text: textBefore });
      }
    }
    parts.push({
      type: "document",
      title: match[1],
      content: match[2].trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last document tag
  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex).trim();
    if (remaining) {
      parts.push({ type: "text", text: remaining });
    }
  }

  // If no document tags found, return the whole content as text
  if (parts.length === 0 && content.trim()) {
    parts.push({ type: "text", text: content });
  }

  return parts;
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isBlock =
              match || (typeof children === "string" && children.includes("\n"));
            if (isBlock) {
              return (
                <pre className="bg-muted rounded-md p-3 overflow-x-auto text-xs">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              );
            }
            return (
              <code
                className="bg-muted px-1 py-0.5 rounded text-xs"
                {...props}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-primary text-primary-foreground">
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  // Parse assistant messages for document tags
  const parts = parseMessageContent(message.content);

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[80%] space-y-2">
        {parts.map((part, i) =>
          part.type === "document" ? (
            <DocumentCard key={i} title={part.title} content={part.content} />
          ) : (
            <div
              key={i}
              className="rounded-2xl px-4 py-2.5 bg-card border shadow-sm"
            >
              <MarkdownContent text={part.text} />
            </div>
          )
        )}
      </div>
    </div>
  );
}

function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-card border shadow-sm">
        <MarkdownContent text={text} />
        <span className="inline-block w-2 h-4 bg-foreground/60 animate-pulse ml-0.5 align-text-bottom" />
      </div>
    </div>
  );
}

export function ChatMessages({
  messages,
  streamingText,
  isStreaming,
  activeToolStatus,
  onSuggestedPrompt,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, activeToolStatus]);

  // Empty state
  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="max-w-md text-center space-y-6">
          <div>
            <h2 className="text-2xl font-semibold mb-2">ScholarMark AI</h2>
            <p className="text-muted-foreground">
              Your academic writing assistant. Ask me about research, writing,
              citations, or anything related to academic work.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {SUGGESTED_PROMPTS.map((item) => (
              <button
                key={item.label}
                onClick={() => onSuggestedPrompt?.(item.prompt)}
                className="flex flex-col items-start gap-2 p-3 rounded-lg border bg-card hover:bg-accent transition-colors text-left"
              >
                <item.icon className="h-4 w-4 text-primary" />
                <span className="text-sm">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="max-w-3xl mx-auto p-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isStreaming && streamingText && <StreamingBubble text={streamingText} />}
        {isStreaming && activeToolStatus?.status === "running" && (
          <ThinkingIndicator
            tool={activeToolStatus.tool}
            label={activeToolStatus.label}
          />
        )}
        {isStreaming && !streamingText && !activeToolStatus && (
          <div className="flex justify-start mb-4">
            <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-card border shadow-sm">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
