import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  requiredTier: string;
  feature: string;
}

const TIER_LABELS: Record<string, string> = {
  pro: "Pro ($14/mo)",
  max: "Max ($50/mo)",
};

export function UpgradeModal({ open, onClose, requiredTier, feature }: UpgradeModalProps) {
  const [, setLocation] = useLocation();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upgrade Required</DialogTitle>
          <DialogDescription>
            <strong>{feature}</strong> requires the{" "}
            <strong>{TIER_LABELS[requiredTier] ?? requiredTier}</strong> plan.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-2 text-sm text-muted-foreground">
          {requiredTier === "pro" && (
            <>
              <p>Pro includes:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>50 documents, 10 projects, 500 MB storage</li>
                <li>AI chat, writing (Quick Draft), and export</li>
                <li>GPT-4o-mini Vision OCR</li>
                <li>Chrome extension &amp; bibliography generation</li>
              </ul>
            </>
          )}
          {requiredTier === "max" && (
            <>
              <p>Max includes everything in Pro, plus:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Unlimited documents, projects, 5 GB storage</li>
                <li>Deep Write (Sonnet 4.5 with extended thinking)</li>
                <li>Source Verified pipeline &amp; bulk export</li>
                <li>GPT-4o Vision OCR &amp; 2M tokens/mo</li>
              </ul>
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Maybe Later
          </Button>
          <Button
            onClick={() => {
              onClose();
              setLocation("/pricing");
            }}
          >
            View Pricing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
