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
import {
  BILLING_PLAN_LABELS,
  MODEL_ACCESS_DISCLAIMER,
  PLAN_MODEL_ACCESS,
  planPriceLabel,
} from "@shared/billingPlans";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  requiredTier: string;
  feature: string;
}

const TIER_LABELS: Record<string, string> = {
  pro: planPriceLabel("pro"),
  max: planPriceLabel("max"),
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
                <li>50 sources per project, 10 projects, 500 MB storage</li>
                <li>Higher AI credit, token, and cost allowances</li>
                <li>GPT-4o-mini Vision OCR</li>
                {PLAN_MODEL_ACCESS.pro.map((line) => (
                  <li key={line}>{line}</li>
                ))}
                <li>More room for source-grounded drafting and analysis</li>
              </ul>
            </>
          )}
          {requiredTier === "max" && (
            <>
              <p>{BILLING_PLAN_LABELS.max} includes everything in Pro, plus:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>No set source/project count limit, with 5 GB storage</li>
                <li>{PLAN_MODEL_ACCESS.max[PLAN_MODEL_ACCESS.max.length - 1]}</li>
                <li>Highest limits for source-grounded drafting</li>
                <li>GPT-4o Vision OCR &amp; 2M tokens/mo</li>
              </ul>
            </>
          )}
          {requiredTier === "pro" || requiredTier === "max" ? (
            <p className="text-xs">{MODEL_ACCESS_DISCLAIMER}</p>
          ) : null}
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
