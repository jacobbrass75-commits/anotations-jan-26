import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAnalyticsOverview, useAnalyticsConversations, useSiteAnalytics } from "@/hooks/useAnalytics";
import { OverviewCards } from "@/components/analytics/OverviewCards";
import { ToolCallChart } from "@/components/analytics/ToolCallChart";
import { TokenUsageChart } from "@/components/analytics/TokenUsageChart";
import { WarningBreakdownChart } from "@/components/analytics/WarningBreakdownChart";
import { ConversationTable } from "@/components/analytics/ConversationTable";
import { ConversationTimeline } from "@/components/analytics/ConversationTimeline";

type TimeRange = "24h" | "7d" | "30d" | "all";

function getFromTimestamp(range: TimeRange): number {
  const now = Date.now();
  switch (range) {
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return now - 30 * 24 * 60 * 60 * 1000;
    case "all":
      return 0;
  }
}

export default function AdminAnalytics() {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);

  const now = Date.now();
  const from = getFromTimestamp(timeRange);

  const { data: overview, isLoading: overviewLoading } = useAnalyticsOverview(from, now);
  const { data: convData, isLoading: convsLoading } = useAnalyticsConversations(from, now);
  const { data: siteData } = useSiteAnalytics(from, now);

  const conversations = convData?.conversations ?? [];
  const topSources = overview?.topRequestedSources ?? [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <Activity className="h-5 w-5 text-primary" />
            <h1 className="font-sans uppercase tracking-[0.2em] font-bold text-primary text-sm">
              WRITING HARNESS
            </h1>
            <div className="eva-status-active" />
          </div>
          <div className="flex items-center gap-1">
            {(["24h", "7d", "30d", "all"] as TimeRange[]).map((range) => (
              <Button
                key={range}
                variant={timeRange === range ? "default" : "outline"}
                size="sm"
                className="text-xs font-mono uppercase tracking-wider h-7 px-3"
                onClick={() => setTimeRange(range)}
              >
                {range}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 space-y-6 eva-grid-bg">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            ["Site views", siteData?.totals.page_views ?? 0],
            ["Unique visitors", siteData?.totals.unique_visitors ?? 0],
            ["Sessions", siteData?.totals.sessions ?? 0],
          ].map(([label, value]) => (
            <Card key={label} className="bg-card/70 border-border">
              <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wider">{label}</CardTitle></CardHeader>
              <CardContent className="text-3xl font-mono text-primary">{value}</CardContent>
            </Card>
          ))}
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {[{ title: "Traffic sources", rows: siteData?.sources ?? [], key: "source" }, { title: "Top pages", rows: siteData?.pages ?? [], key: "path" }].map((table) => (
            <Card key={table.title} className="bg-card/70 border-border">
              <CardHeader><CardTitle className="eva-section-title">{table.title}</CardTitle></CardHeader>
              <CardContent className="space-y-2 font-mono text-xs">
                {table.rows.length === 0 ? <div className="text-muted-foreground">No traffic data yet</div> : table.rows.map((row) => (
                  <div key={String(row[table.key as keyof typeof row])} className="flex justify-between border-b border-border/30 pb-2">
                    <span className="truncate pr-4">{String(row[table.key as keyof typeof row])}</span>
                    <span>{row.page_views} views / {row.unique_visitors} visitors</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </section>

        <OverviewCards
          overview={overview}
          conversations={conversations}
          isLoading={overviewLoading}
        />

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ToolCallChart data={overview?.toolCallFrequency ?? []} />
          <TokenUsageChart data={overview?.tokenUsageByTurn ?? []} />
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <WarningBreakdownChart data={overview?.warningLevelBreakdown ?? []} />

          <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="eva-section-title">Top Requested Sources</CardTitle>
            </CardHeader>
            <CardContent>
              {topSources.length === 0 ? (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground font-mono text-sm">
                  No source data yet
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left py-1.5 px-2">Document</th>
                        <th className="text-left py-1.5 px-2">Tool</th>
                        <th className="text-right py-1.5 px-2">Pulls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topSources.slice(0, 10).map((src, i) => (
                        <tr key={i} className="border-b border-border/30">
                          <td className="py-1.5 px-2 text-primary truncate max-w-[180px]">
                            {src.documentId.slice(0, 16)}...
                          </td>
                          <td className="py-1.5 px-2 text-muted-foreground">
                            {src.toolName.replace("get_", "")}
                          </td>
                          <td className="py-1.5 px-2 text-right text-chart-3">{src.pullCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <ConversationTable
          conversations={conversations}
          isLoading={convsLoading}
          onSelect={setSelectedConversation}
        />

        <ConversationTimeline
          conversationId={selectedConversation}
          onClose={() => setSelectedConversation(null)}
        />
      </main>
    </div>
  );
}
