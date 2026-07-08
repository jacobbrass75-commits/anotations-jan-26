import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getQueryFn } from "@/lib/queryClient";

interface BreakdownRow {
  value: string;
  signups: number;
  activated: number;
}

interface CampaignMetrics {
  totals: {
    visits: number;
    signups: number;
    activated: number;
    referredSignups: number;
    referrers: number;
  };
  rates: {
    signupRate: number | null;
    activationRate: number | null;
    referralRate: number | null;
  };
  breakdowns: {
    channel: BreakdownRow[];
    school: BreakdownRow[];
    major: BreakdownRow[];
    classYear: BreakdownRow[];
    paperType: BreakdownRow[];
  };
  weeklySignups: Array<{ week: string; signups: number }>;
  recentSignups: Array<{
    name: string | null;
    email: string;
    school: string | null;
    major: string | null;
    classYear: string | null;
    paperType: string | null;
    channel: string | null;
    referredBy: string | null;
    referralCode: string;
    activated: boolean;
    firstAction: string | null;
    signupDate: number;
  }>;
}

function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No signups yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Value</th>
                <th className="pb-2 font-medium text-right">Signups</th>
                <th className="pb-2 font-medium text-right">Activated</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((row) => (
                <tr key={row.value} className="border-t border-border/50">
                  <td className="py-1.5">{row.value}</td>
                  <td className="py-1.5 text-right">{row.signups}</td>
                  <td className="py-1.5 text-right">{row.activated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminCampaign() {
  const { data, isLoading, error } = useQuery<CampaignMetrics>({
    queryKey: ["/api/admin/campaign/metrics"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <Megaphone className="h-5 w-5 text-primary" />
          <h1 className="font-sans uppercase tracking-[0.2em] font-bold text-primary text-sm">
            Summer Campaign
          </h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6 max-w-6xl">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading campaign metrics...</p>
        ) : error ? (
          <p className="text-sm text-destructive">
            Could not load campaign metrics. Admin access (ADMIN_USER_IDS) is required.
          </p>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatCard label="Link clicks" value={String(data.totals.visits)} />
              <StatCard label="Signups" value={String(data.totals.signups)} />
              <StatCard
                label="Signup rate"
                value={formatRate(data.rates.signupRate)}
                hint="signups / clicks"
              />
              <StatCard label="Activated" value={String(data.totals.activated)} />
              <StatCard
                label="Activation rate"
                value={formatRate(data.rates.activationRate)}
                hint="used the tool / signups"
              />
              <StatCard
                label="Referral rate"
                value={formatRate(data.rates.referralRate)}
                hint="referrers / activated"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <BreakdownTable title="By channel" rows={data.breakdowns.channel} />
              <BreakdownTable title="By school" rows={data.breakdowns.school} />
              <BreakdownTable title="By major" rows={data.breakdowns.major} />
              <BreakdownTable title="By class year" rows={data.breakdowns.classYear} />
              <BreakdownTable title="By paper type" rows={data.breakdowns.paperType} />
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Signups by week</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.weeklySignups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No signups yet</p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {data.weeklySignups.map((row) => (
                          <tr key={row.week} className="border-t border-border/50 first:border-0">
                            <td className="py-1.5 font-mono text-xs">{row.week}</td>
                            <td className="py-1.5 text-right">{row.signups}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent signups</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {data.recentSignups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No signups yet. Share an invite link like{" "}
                    <code className="font-mono text-xs">
                      /summer?campus=ucla&amp;major=history&amp;channel=discord
                    </code>
                  </p>
                ) : (
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-4 font-medium">Name</th>
                        <th className="pb-2 pr-4 font-medium">Email</th>
                        <th className="pb-2 pr-4 font-medium">School</th>
                        <th className="pb-2 pr-4 font-medium">Major</th>
                        <th className="pb-2 pr-4 font-medium">Year</th>
                        <th className="pb-2 pr-4 font-medium">Channel</th>
                        <th className="pb-2 pr-4 font-medium">Referred by</th>
                        <th className="pb-2 pr-4 font-medium">Activated</th>
                        <th className="pb-2 font-medium">First action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentSignups.map((signup) => (
                        <tr key={signup.email} className="border-t border-border/50">
                          <td className="py-1.5 pr-4">{signup.name ?? "—"}</td>
                          <td className="py-1.5 pr-4">{signup.email}</td>
                          <td className="py-1.5 pr-4">{signup.school ?? "—"}</td>
                          <td className="py-1.5 pr-4">{signup.major ?? "—"}</td>
                          <td className="py-1.5 pr-4">{signup.classYear ?? "—"}</td>
                          <td className="py-1.5 pr-4">{signup.channel ?? "—"}</td>
                          <td className="py-1.5 pr-4">{signup.referredBy ?? "—"}</td>
                          <td className="py-1.5 pr-4">{signup.activated ? "Yes" : "No"}</td>
                          <td className="py-1.5">{signup.firstAction ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </main>
    </div>
  );
}
