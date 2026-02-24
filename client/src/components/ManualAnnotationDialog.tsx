import { useState } from "react";
import { Highlighter } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnnotationCategory } from "@shared/schema";

interface ManualAnnotationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedText: { text: string; start: number; end: number } | null;
  onSave: (note: string, category: AnnotationCategory) => void;
}

export function ManualAnnotationDialog({
  open,
  onOpenChange,
  selectedText,
  onSave,
}: ManualAnnotationDialogProps) {
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<AnnotationCategory>("user_added");

  const handleSave = () => {
    if (note.trim()) {
      onSave(note.trim(), category);
      setNote("");
      setCategory("user_added");
      onOpenChange(false);
    }
  };

  const handleClose = () => {
    setNote("");
    setCategory("user_added");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px] eva-grid-bg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 eva-section-title text-base">
            <Highlighter className="h-5 w-5 text-primary" />
            MANUAL ANNOTATION
          </DialogTitle>
          <DialogDescription>
            Create a note for the selected text passage.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {selectedText && (
            <div className="p-3 bg-eva-dark/50 rounded-lg border border-eva-orange/20 border-l-2 border-l-eva-orange">
              <Label className="text-xs text-muted-foreground mb-1 block">Selected Text</Label>
              <p className="text-sm font-serif line-clamp-4">"{selectedText.text}"</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as AnnotationCategory)}>
              <SelectTrigger id="category" className="eva-focus-glow" data-testid="select-manual-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="key_quote">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#FF6A00]" />
                    Key Quote
                  </div>
                </SelectItem>
                <SelectItem value="evidence">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#00FF41]" />
                    Evidence
                  </div>
                </SelectItem>
                <SelectItem value="argument">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#00D4FF]" />
                    Argument
                  </div>
                </SelectItem>
                <SelectItem value="methodology">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                    Methodology
                  </div>
                </SelectItem>
                <SelectItem value="user_added">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#CC0000]" />
                    Your Note
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Note</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why is this passage important? What does it relate to in your research?"
              className="h-28 resize-none"
              data-testid="textarea-manual-note"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="uppercase tracking-wider" onClick={handleClose}>
            Cancel
          </Button>
          <Button className="uppercase tracking-wider" onClick={handleSave} disabled={!note.trim()} data-testid="button-save-manual-annotation">
            Save Annotation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
