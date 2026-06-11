import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background eva-grid-bg">
      <Card className="w-full max-w-md mx-4 eva-clip-panel eva-corner-decor">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-xl font-mono text-destructive">ERROR 404 // PATTERN NOT FOUND</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            Did you forget to add the page to the router?
          </p>
          <Link href="/">
            <Button variant="outline" className="mt-4 uppercase tracking-wider font-mono">
              Return Home
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
