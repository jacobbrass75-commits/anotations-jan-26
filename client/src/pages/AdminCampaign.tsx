import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Copy, Download, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getQueryFn } from "@/lib/queryClient";

const CAMPAIGN_URL = "https://scholarmark.ai/summer";

interface BreakdownRow {
  value: string;
  signups: number;
  activated: number;
  paid: number;
}

interface CampaignMetrics {
  totals: {
    visits: number;
    signups: number;
    registered: number;
    activated: number;
    paid: number;
    activatedPaid: number;
    referredSignups: number;
    referrers: number;
  };
  rates: {
    signupRate: number | null;
    registrationRate: number | null;
    activationRate: number | null;
    paidRate: number | null;
    activatedPaidRate: number | null;
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
    name: string;
    email: string;
    school: string;
    major: string;
    classYear: string;
    paperType: string;
    campus: string | null;
    channel: string | null;
    inviteCode: string | null;
    referredBy: string | null;
    referralCode: string;
    registered: boolean;
    activated: boolean;
    firstAction: string | null;
    paid: boolean;
    paidEver: boolean;
    paidProvider: string | null;
    plan: string | null;
    subscriptionStatus: string | null;
    accountCreatedAt: number | null;
    checkoutStartedAt: number | null;
    paidAt: number | null;
    signupDate: number;
  }>;
}

function formatRate(rate: number | null): string {
  if (rate === null) return "-";
  return `${(rate * 100).toFixed(1)}%`;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "-";
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeLinkValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
                <th className="pb-2 font-medium text-right">Paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 8).map((row) => (
                <tr key={row.value} className="border-t border-border/50">
                  <td className="py-1.5">{row.value}</td>
                  <td className="py-1.5 text-right">{row.signups}</td>
                  <td className="py-1.5 text-right">{row.activated}</td>
                  <td className="py-1.5 text-right">{row.paid}</td>
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
  const [linkFields, setLinkFields] = useState({
    campus: "general",
    major: "history",
    channel: "friend",
    code: "SUMMERTHESIS",
  });
  const [copyState, setCopyState] = useState("Copy link");
  const { data, isLoading, error } = useQuery<CampaignMetrics>({
    queryKey: ["/api/admin/campaign/metrics"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const trackedLink = useMemo(() => {
    const url = new URL(CAMPAIGN_URL);
    const params: Array<[string, string]> = [
      ["campus", linkFields.campus],
      ["major", linkFields.major],
      ["channel", linkFields.channel],
      ["code", linkFields.code],
    ];
    for (const [key, value] of params) {
      const normalized = normalizeLinkValue(value);
      if (normalized) url.searchParams.set(key, normalized);
    }
    return url.toString();
  }, [linkFields]);

  function updateLinkField(field: keyof typeof linkFields, value: string) {
    setCopyState("Copy link");
    setLinkFields((current) => ({ ...current, [field]: value }));
  }

  async function copyTrackedLink() {
    try {
      await navigator.clipboard.writeText(trackedLink);
      setCopyState("Copied");
    } catch {
      setCopyState("Copy failed");
    }
  }

  function exportRecentSignups() {
    if (!data?.recentSignups.length) return;

    const headers = [
      "name",
      "email",
      "school",
      "major",
      "classYear",
      "paperType",
      "campus",
      "channel",
      "inviteCode",
      "referralCode",
      "referredBy",
      "registered",
      "activated",
      "firstAction",
      "checkoutStartedAt",
      "paid",
      "paidEver",
      "paidProvider",
      "plan",
      "subscriptionStatus",
      "paidAt",
      "signupDate",
      "accountCreatedAt",
    ];
    const rows = data.recentSignups.map((signup) => [
      signup.name,
      signup.email,
      signup.school,
      signup.major,
      signup.classYear,
      signup.paperType,
      signup.campus,
      signup.channel,
      signup.inviteCode,
      signup.referralCode,
      signup.referredBy,
      signup.registered,
      signup.activated,
      signup.firstAction,
      signup.checkoutStartedAt ? new Date(signup.checkoutStartedAt).toISOString() : "",
      signup.paid,
      signup.paidEver,
      signup.paidProvider,
      signup.plan,
      signup.subscriptionStatus,
      signup.paidAt ? new Date(signup.paidAt).toISOString() : "",
      new Date(signup.signupDate).toISOString(),
      signup.accountCreatedAt ? new Date(signup.accountCreatedAt).toISOString() : "",
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `scholarmark-campaign-signups-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(objectUrl);
  }

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
          <Button
            variant="outline"
            size="sm"
            className="ml-auto gap-2"
            onClick={exportRecentSignups}
            disabled={!data?.recentSignups.length}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Link clicks" value={String(data.totals.visits)} />
              <StatCard label="Signups" value={String(data.totals.signups)} />
              <StatCard
                label="Accounts"
                value={String(data.totals.registered)}
                hint={formatRate(data.rates.registrationRate)}
              />
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
                label="Paid"
                value={String(data.totals.paid)}
                hint="durable paid conversions"
              />
              <StatCard
                label="Paid rate"
                value={formatRate(data.rates.paidRate)}
                hint="paid / signups"
              />
              <StatCard
                label="Activated paid"
                value={String(data.totals.activatedPaid)}
                hint={formatRate(data.rates.activatedPaidRate)}
              />
              <StatCard
                label="Referral rate"
                value={formatRate(data.rates.referralRate)}
                hint="referrers / activated"
              />
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Tracked link builder</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Input
                    aria-label="Campus"
                    value={linkFields.campus}
                    onChange={(event) => updateLinkField("campus", event.target.value)}
                    placeholder="campus"
                  />
                  <Input
                    aria-label="Major"
                    value={linkFields.major}
                    onChange={(event) => updateLinkField("major", event.target.value)}
                    placeholder="major"
                  />
                  <Input
                    aria-label="Channel"
                    value={linkFields.channel}
                    onChange={(event) => updateLinkField("channel", event.target.value)}
                    placeholder="channel"
                  />
                  <Input
                    aria-label="Invite code"
                    value={linkFields.code}
                    onChange={(event) => updateLinkField("code", event.target.value)}
                    placeholder="code"
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <code className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-xs overflow-x-auto">
                    {trackedLink}
                  </code>
                  <Button variant="secondary" className="gap-2" onClick={copyTrackedLink}>
                    <Copy className="h-4 w-4" />
                    {copyState}
                  </Button>
                </div>
              </CardContent>
            </Card>

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
                        <th className="pb-2 pr-4 font-medium">Invite</th>
                        <th className="pb-2 pr-4 font-medium">Referral</th>
                        <th className="pb-2 pr-4 font-medium">Referred by</th>
                        <th className="pb-2 pr-4 font-medium">Account</th>
                        <th className="pb-2 pr-4 font-medium">Activated</th>
                        <th className="pb-2 pr-4 font-medium">Checkout</th>
                        <th className="pb-2 pr-4 font-medium">Paid</th>
                        <th className="pb-2 pr-4 font-medium">Plan</th>
                        <th className="pb-2 pr-4 font-medium">Paid date</th>
                        <th className="pb-2 font-medium">First action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentSignups.map((signup) => (
                        <tr key={signup.email} className="border-t border-border/50">
                          <td className="py-1.5 pr-4">{signup.name}</td>
                          <td className="py-1.5 pr-4">{signup.email}</td>
                          <td className="py-1.5 pr-4">{signup.school}</td>
                          <td className="py-1.5 pr-4">{signup.major}</td>
                          <td className="py-1.5 pr-4">{signup.classYear}</td>
                          <td className="py-1.5 pr-4">{signup.channel ?? "-"}</td>
                          <td className="py-1.5 pr-4">{signup.inviteCode ?? "-"}</td>
                          <td className="py-1.5 pr-4 font-mono text-xs">{signup.referralCode}</td>
                          <td className="py-1.5 pr-4">{signup.referredBy ?? "-"}</td>
                          <td className="py-1.5 pr-4">{signup.registered ? "Yes" : "No"}</td>
                          <td className="py-1.5 pr-4">{signup.activated ? "Yes" : "No"}</td>
                          <td className="py-1.5 pr-4">{formatDate(signup.checkoutStartedAt)}</td>
                          <td className="py-1.5 pr-4">
                            {signup.paid ? "Yes" : (signup.subscriptionStatus ?? "No")}
                          </td>
                          <td className="py-1.5 pr-4">{signup.plan ?? "-"}</td>
                          <td className="py-1.5 pr-4">{formatDate(signup.paidAt)}</td>
                          <td className="py-1.5">{signup.firstAction ?? "-"}</td>
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
