import { useState, useMemo } from "react";
import { MessageSquare, Bot, User, Trash2, Edit2, Filter, Plus, Quote } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Annotation, AnnotationCategory } from "@shared/schema";

// Extended annotation type with prompt fields
interface AnnotationWithPrompt extends Omit<Annotation, 'promptText' | 'promptIndex' | 'promptColor'> {
  promptText?: string | null;
  promptIndex?: number | null;
  promptColor?: string | null;
}

interface AnnotationSidebarProps {
  annotations: AnnotationWithPrompt[];
  isLoading: boolean;
  selectedAnnotationId: string | null;
  onSelect: (annotation: AnnotationWithPrompt) => void;
  onDelete: (annotationId: string) => void;
  onUpdate: (annotationId: string, note: string, category: AnnotationCategory) => void;
  onAddManual: () => void;
  canAddManual: boolean;
  showFootnoteButton?: boolean;
  onCopyFootnote?: (annotationId: string) => void;
}

type FilterType = "all" | "ai" | "manual" | AnnotationCategory;
type PromptFilterType = "all" | number; // "all" or prompt index

const categoryColors: Record<AnnotationCategory, string> = {
  key_quote: "bg-yellow-500",
  evidence: "bg-green-500",
  argument: "bg-blue-500",
  methodology: "bg-purple-500",
  user_added: "bg-orange-500",
};

const categoryLabels: Record<AnnotationCategory, string> = {
  key_quote: "Key Quote",
  evidence: "Evidence",
  argument: "Argument",
  methodology: "Methodology",
  user_added: "Your Note",
};

export function AnnotationSidebar({
  annotations,
  isLoading,
  selectedAnnotationId,
  onSelect,
  onDelete,
  onUpdate,
  onAddManual,
  canAddManual,
  showFootnoteButton = false,
  onCopyFootnote,
}: AnnotationSidebarProps) {
  const [filter, setFilter] = useState<FilterType>("all");
  const [promptFilter, setPromptFilter] = useState<PromptFilterType>("all");
  const [editingAnnotation, setEditingAnnotation] = useState<AnnotationWithPrompt | null>(null);
  const [editNote, setEditNote] = useState("");
  const [editCategory, setEditCategory] = useState<AnnotationCategory>("user_added");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Get unique prompts from annotations
  const uniquePrompts = useMemo(() => {
    const promptMap = new Map<number, { text: string; color: string; count: number }>();
    for (const ann of annotations) {
      if (ann.promptIndex != null && ann.promptText) {
        const existing = promptMap.get(ann.promptIndex);
        if (existing) {
          existing.count++;
        } else {
          promptMap.set(ann.promptIndex, {
            text: ann.promptText,
            color: ann.promptColor || "#888",
            count: 1,
          });
        }
      }
    }
    return promptMap;
  }, [annotations]);

  const hasMultiplePrompts = uniquePrompts.size > 1;

  const filteredAnnotations = useMemo(() => {
    return annotations.filter((a) => {
      // Category/type filter
      let passesFilter = true;
      if (filter === "ai") passesFilter = a.isAiGenerated;
      else if (filter === "manual") passesFilter = !a.isAiGenerated;
      else if (filter !== "all") passesFilter = a.category === filter;

      // Prompt filter
      let passesPromptFilter = true;
      if (promptFilter !== "all") {
        passesPromptFilter = a.promptIndex === promptFilter;
      }

      return passesFilter && passesPromptFilter;
    });
  }, [annotations, filter, promptFilter]);

  const handleEditStart = (annotation: AnnotationWithPrompt) => {
    setEditingAnnotation(annotation);
    setEditNote(annotation.note);
    setEditCategory(annotation.category);
  };

  const handleEditSave = () => {
    if (editingAnnotation && editNote.trim()) {
      onUpdate(editingAnnotation.id, editNote.trim(), editCategory);
      setEditingAnnotation(null);
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirmId) {
      onDelete(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  };

  if (isLoading) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="flex flex-row items-center gap-2 pb-4 border-b">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Annotations</h2>
        </CardHeader>
        <CardContent className="flex-1 p-4">
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-12 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="h-full flex flex-col overflow-hidden">
        <CardHeader className="flex flex-col gap-3 pb-4 border-b shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Annotations</h2>
            </div>
            <Badge variant="secondary">{annotations.length}</Badge>
          </div>

          <div className="flex items-center gap-2">
            <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
              <SelectTrigger className="flex-1" data-testid="select-annotation-filter">
                <Filter className="h-3.5 w-3.5 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="ai">AI Generated</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="key_quote">Key Quotes</SelectItem>
                <SelectItem value="evidence">Evidence</SelectItem>
                <SelectItem value="argument">Arguments</SelectItem>
                <SelectItem value="methodology">Methodology</SelectItem>
                <SelectItem value="user_added">Your Notes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Prompt Filter - only show if there are multiple prompts */}
          {hasMultiplePrompts && (
            <div className="flex items-center gap-2">
              <Select
                value={String(promptFilter)}
                onValueChange={(v) => setPromptFilter(v === "all" ? "all" : Number(v))}
              >
                <SelectTrigger className="flex-1" data-testid="select-prompt-filter">
                  <SelectValue placeholder="All Prompts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Prompts</SelectItem>
                  {Array.from(uniquePrompts.entries()).map(([index, { text, color, count }]) => (
                    <SelectItem key={index} value={String(index)}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="truncate max-w-[150px]">{text}</span>
                        <span className="text-muted-foreground">({count})</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={onAddManual}
            disabled={!canAddManual}
            data-testid="button-add-manual-annotation"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Manual Note
          </Button>
        </CardHeader>

        <CardContent className="flex-1 p-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-3">
              {filteredAnnotations.length === 0 ? (
                <div className="text-center py-8">
                  <div className="mx-auto w-12 h-12 bg-muted rounded-full flex items-center justify-center mb-3">
                    <MessageSquare className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {annotations.length === 0
                      ? "No annotations yet"
                      : "No matching annotations"}
                  </p>
                </div>
              ) : (
                filteredAnnotations.map((annotation) => (
                  <div
                    key={annotation.id}
                    onClick={() => onSelect(annotation)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && onSelect(annotation)}
                    className={`w-full text-left p-3 rounded-lg border transition-all duration-150 cursor-pointer hover-elevate ${
                      selectedAnnotationId === annotation.id
                        ? "border-primary bg-primary/5"
                        : "border-transparent bg-muted/50 hover:bg-muted"
                    }`}
                    data-testid={`annotation-item-${annotation.id}`}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      {/* Show prompt color if available, otherwise category color */}
                      <div
                        className="w-2.5 h-2.5 rounded-full mt-1 shrink-0"
                        style={annotation.promptColor ? { backgroundColor: annotation.promptColor } : undefined}
                        {...(!annotation.promptColor && { className: `w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${categoryColors[annotation.category]}` })}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary" className="text-xs">
                            {categoryLabels[annotation.category]}
                          </Badge>
                          {annotation.isAiGenerated ? (
                            <Bot className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <User className="h-3 w-3 text-muted-foreground" />
                          )}
                          {/* Show prompt indicator if from multi-prompt analysis */}
                          {annotation.promptText && hasMultiplePrompts && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: `${annotation.promptColor}20`,
                                color: annotation.promptColor || undefined,
                              }}
                            >
                              P{(annotation.promptIndex ?? 0) + 1}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground font-mono line-clamp-2 mb-2">
                      "{annotation.highlightedText}"
                    </p>

                    <p className="text-sm text-foreground line-clamp-2">{annotation.note}</p>

                    <div className="flex items-center justify-end gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {showFootnoteButton && onCopyFootnote && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Copy Footnote"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCopyFootnote(annotation.id);
                          }}
                          data-testid={`button-footnote-${annotation.id}`}
                        >
                          <Quote className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditStart(annotation);
                        }}
                        data-testid={`button-edit-${annotation.id}`}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(annotation.id);
                        }}
                        data-testid={`button-delete-${annotation.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingAnnotation} onOpenChange={() => setEditingAnnotation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Annotation</DialogTitle>
            <DialogDescription>Update the note and category for this highlight.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={editCategory} onValueChange={(v) => setEditCategory(v as AnnotationCategory)}>
                <SelectTrigger data-testid="select-edit-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="key_quote">Key Quote</SelectItem>
                  <SelectItem value="evidence">Evidence</SelectItem>
                  <SelectItem value="argument">Argument</SelectItem>
                  <SelectItem value="methodology">Methodology</SelectItem>
                  <SelectItem value="user_added">Your Note</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="Add your note..."
                className="h-24"
                data-testid="textarea-edit-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAnnotation(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} data-testid="button-save-edit">
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Annotation</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this annotation? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} data-testid="button-confirm-delete">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
