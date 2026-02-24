import { useMemo, useCallback, useState, useRef, useEffect } from "react";
import type { Annotation, AnnotationCategory } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Bot, User, X } from "lucide-react";

// Extended annotation type with prompt fields
interface AnnotationWithPrompt extends Omit<Annotation, 'promptText' | 'promptIndex' | 'promptColor'> {
  promptText?: string | null;
  promptIndex?: number | null;
  promptColor?: string | null;
}

interface HighlightedTextProps {
  text: string;
  annotations: AnnotationWithPrompt[];
  onAnnotationClick: (annotation: AnnotationWithPrompt) => void;
  selectedAnnotationId: string | null;
  onTextSelect?: (selection: { text: string; start: number; end: number }) => void;
}

const categoryColors: Record<AnnotationCategory, { bg: string; border: string; hover: string }> = {
  key_quote: {
    bg: "bg-[#FF6A00]/20",
    border: "border-l-4 border-[#FF6A00]",
    hover: "hover:bg-[#FF6A00]/30",
  },
  evidence: {
    bg: "bg-[#00FF41]/15",
    border: "border-l-4 border-[#00FF41]",
    hover: "hover:bg-[#00FF41]/25",
  },
  argument: {
    bg: "bg-[#00D4FF]/15",
    border: "border-l-4 border-[#00D4FF]",
    hover: "hover:bg-[#00D4FF]/25",
  },
  methodology: {
    bg: "bg-[#8B5CF6]/20",
    border: "border-l-4 border-[#8B5CF6]",
    hover: "hover:bg-[#8B5CF6]/30",
  },
  user_added: {
    bg: "bg-[#CC0000]/15",
    border: "border-l-4 border-[#CC0000]",
    hover: "hover:bg-[#CC0000]/25",
  },
};

const categoryLabels: Record<AnnotationCategory, string> = {
  key_quote: "Key Quote",
  evidence: "Evidence",
  argument: "Argument",
  methodology: "Methodology",
  user_added: "Your Note",
};

interface TextSegment {
  start: number;
  end: number;
  text: string;
  annotation: AnnotationWithPrompt | null;
}

export function HighlightedText({
  text,
  annotations,
  onAnnotationClick,
  selectedAnnotationId,
  onTextSelect,
}: HighlightedTextProps) {
  const [activePopover, setActivePopover] = useState<AnnotationWithPrompt | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Build segments with highlights
  const segments = useMemo(() => {
    if (!annotations.length) {
      return [{ start: 0, end: text.length, text, annotation: null }];
    }

    const sortedAnnotations = [...annotations].sort((a, b) => a.startPosition - b.startPosition);
    const result: TextSegment[] = [];
    let currentPos = 0;

    for (const annotation of sortedAnnotations) {
      // Add non-highlighted text before this annotation
      if (annotation.startPosition > currentPos) {
        result.push({
          start: currentPos,
          end: annotation.startPosition,
          text: text.slice(currentPos, annotation.startPosition),
          annotation: null,
        });
      }

      // Add highlighted segment
      if (annotation.startPosition >= currentPos) {
        result.push({
          start: annotation.startPosition,
          end: annotation.endPosition,
          text: text.slice(annotation.startPosition, annotation.endPosition),
          annotation,
        });
        currentPos = annotation.endPosition;
      }
    }

    // Add remaining text after last annotation
    if (currentPos < text.length) {
      result.push({
        start: currentPos,
        end: text.length,
        text: text.slice(currentPos),
        annotation: null,
      });
    }

    return result;
  }, [text, annotations]);

  const handleMouseUp = useCallback(() => {
    if (!onTextSelect) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    const range = selection.getRangeAt(0);
    const container = containerRef.current;
    if (!container) return;

    // Find the start and end positions in the original text
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let currentOffset = 0;
    let startOffset = -1;
    let endOffset = -1;

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const nodeLength = node.length;

      if (node === range.startContainer) {
        startOffset = currentOffset + range.startOffset;
      }
      if (node === range.endContainer) {
        endOffset = currentOffset + range.endOffset;
        break;
      }

      currentOffset += nodeLength;
    }

    if (startOffset >= 0 && endOffset > startOffset) {
      onTextSelect({
        text: selectedText,
        start: startOffset,
        end: endOffset,
      });
    }
  }, [onTextSelect]);

  const handleHighlightClick = useCallback((e: React.MouseEvent, annotation: AnnotationWithPrompt) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    
    if (containerRect) {
      setPopoverPosition({
        top: rect.bottom - containerRect.top + 8,
        left: rect.left - containerRect.left,
      });
    }
    
    setActivePopover(annotation);
    onAnnotationClick(annotation);
  }, [onAnnotationClick]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setActivePopover(null);
        setPopoverPosition(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Split text into paragraphs
  const renderContent = () => {
    return segments.map((segment, index) => {
      if (!segment.annotation) {
        // Render plain text, preserving paragraph breaks
        return segment.text.split("\n\n").map((paragraph, pIndex, arr) => (
          <span key={`${index}-${pIndex}`}>
            {paragraph}
            {pIndex < arr.length - 1 && <span className="block mb-4" />}
          </span>
        ));
      }

      const colors = categoryColors[segment.annotation.category];
      const isSelected = selectedAnnotationId === segment.annotation.id;
      const promptColor = segment.annotation.promptColor;

      // Use prompt color if available, otherwise fall back to category colors
      const highlightStyle = promptColor
        ? {
            backgroundColor: isSelected ? `${promptColor}60` : `${promptColor}30`,
            // Add subtle border for selected state
            boxShadow: isSelected ? `0 0 0 2px ${promptColor}` : undefined,
          }
        : undefined;

      return (
        <mark
          key={segment.annotation.id}
          className={`
            cursor-pointer rounded-sm px-0.5 -mx-0.5 transition-all duration-150
            ${!promptColor ? `${colors.bg} ${colors.border} ${colors.hover}` : "hover:opacity-80"}
            ${isSelected && !promptColor ? "ring-2 ring-offset-1 ring-primary" : ""}
          `}
          style={highlightStyle}
          onClick={(e) => handleHighlightClick(e, segment.annotation!)}
          data-testid={`highlight-${segment.annotation.id}`}
          role="button"
          tabIndex={0}
          aria-label={`${categoryLabels[segment.annotation.category]}: ${segment.text.slice(0, 50)}...`}
        >
          {segment.text}
        </mark>
      );
    });
  };

  return (
    <div
      ref={containerRef}
      className="relative prose prose-sm dark:prose-invert max-w-none leading-relaxed"
      onMouseUp={handleMouseUp}
    >
      <div className="text-base font-serif text-foreground whitespace-pre-wrap">
        {renderContent()}
      </div>

      {/* Popover for annotation details */}
      {activePopover && popoverPosition && (
        <div
          ref={popoverRef}
          className="absolute z-50 animate-in fade-in-0 zoom-in-95"
          style={{ top: popoverPosition.top, left: popoverPosition.left }}
        >
          <Card className="w-80 p-4 shadow-lg eva-clip-sm bg-card">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div
                  className="w-3 h-3 rounded-full"
                  style={activePopover.promptColor ? { backgroundColor: activePopover.promptColor } : undefined}
                  {...(!activePopover.promptColor && {
                    className: `w-3 h-3 rounded-full ${categoryColors[activePopover.category].bg.replace("/20", "")}`,
                  })}
                />
                <Badge variant="secondary" className="text-xs">
                  {categoryLabels[activePopover.category]}
                </Badge>
                {activePopover.isAiGenerated ? (
                  <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                {activePopover.promptText && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: `${activePopover.promptColor}20`,
                      color: activePopover.promptColor || undefined,
                    }}
                  >
                    P{(activePopover.promptIndex ?? 0) + 1}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setActivePopover(null);
                  setPopoverPosition(null);
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm text-muted-foreground font-mono line-clamp-3 mb-3 border-l-2 pl-3 border-muted">
              "{activePopover.highlightedText}"
            </p>

            <p className="text-sm text-foreground">{activePopover.note}</p>

            {activePopover.promptText && (
              <p className="mt-2 text-xs text-muted-foreground italic border-t pt-2">
                <span className="font-medium">Prompt:</span> {activePopover.promptText}
              </p>
            )}

            {activePopover.confidenceScore !== null && activePopover.confidenceScore !== undefined && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Confidence:</span>
                <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${Math.round(activePopover.confidenceScore * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-muted-foreground">
                  {Math.round(activePopover.confidenceScore * 100)}%
                </span>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
