import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  placeholder?: string;
}

const MAX_CHARS = 10000;
const MAX_ROWS = 6;

export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  isStreaming = false,
  placeholder = "Message ScholarMark",
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const lineHeight = 24; // approx line height in px
    const maxHeight = lineHeight * MAX_ROWS;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled || isStreaming) return;
    onSend(trimmed);
    setValue("");
    // Reset height after send
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) return;
      handleSend();
    }
  };

  const handlePrimaryAction = () => {
    if (isStreaming) {
      onStop?.();
      return;
    }

    handleSend();
  };

  return (
    <div className="border-t bg-background/95 px-3 py-3 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            "relative flex items-end gap-2 rounded-2xl border bg-background px-3 py-2 shadow-sm transition-colors",
            "focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15",
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              if (e.target.value.length <= MAX_CHARS) {
                setValue(e.target.value);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-6 focus:outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            style={{ maxHeight: `${24 * MAX_ROWS}px` }}
          />
          <div className="flex shrink-0 items-center gap-2">
            {value.length > MAX_CHARS * 0.8 && (
              <span className="text-xs text-muted-foreground">
                {value.length}/{MAX_CHARS}
              </span>
            )}
            <Button
              size="icon"
              type="button"
              onClick={handlePrimaryAction}
              disabled={disabled || (!isStreaming && !value.trim())}
              className={cn(
                "h-9 w-9 rounded-full",
                isStreaming
                  ? "bg-foreground text-background hover:bg-foreground/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90",
              )}
              aria-label={isStreaming ? "Stop response" : "Send message"}
              title={isStreaming ? "Stop response" : "Send message"}
            >
              {isStreaming ? (
                <Square className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
