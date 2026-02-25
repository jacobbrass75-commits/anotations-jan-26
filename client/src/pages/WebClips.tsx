import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Copy, ExternalLink, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useProjects } from "@/hooks/useProjects";
import { useDeleteWebClip, usePromoteWebClip, useWebClips } from "@/hooks/useWebClips";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { WebClip } from "@shared/schema";

const CATEGORY_OPTIONS = [
  { value: "all", label: "All Categories" },
  { value: "key_quote", label: "Key Quote" },
  { value: "evidence", label: "Evidence" },
  { value: "argument", label: "Argument" },
  { value: "methodology", label: "Methodology" },
  { value: "user_added", label: "User Added" },
  { value: "web_clip", label: "Web Clip" },
];

export default function WebClips() {
  const { toast } = useToast();
  const { data: projects = [] } = useProjects();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [promoteProjectId, setPromoteProjectId] = useState("");

  const filters = useMemo(
    () => ({
      search: search.trim() || undefined,
      category: category === "all" ? undefined : category,
      projectId: projectFilter === "all" ? undefined : projectFilter,
      limit: 200,
      sort: "newest" as const,
    }),
    [search, category, projectFilter],
  );

  const { data: clips = [], isLoading, isError } = useWebClips(filters);
  const deleteClip = useDeleteWebClip();
  const promoteClip = usePromoteWebClip();

  const handleCopyCitation = async (clip: WebClip) => {
    const citation = clip.footnote || clip.bibliography || clip.highlightedText;

    try {
      await copyTextToClipboard(citation);
      toast({
        title: "Copied",
        description: "Citation copied to clipboard",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard access is unavailable in this browser context",
        variant: "destructive",
      });
    }
  };

  const handlePromote = async (clip: WebClip) => {
    const projectId = promoteProjectId || clip.projectId || "";
    if (!projectId) {
      toast({
        title: "Project required",
        description: "Select a target project before promoting this clip.",
        variant: "destructive",
      });
      return;
    }

    try {
      await promoteClip.mutateAsync({
        id: clip.id,
        data: {
          projectId,
          category: clip.category,
        },
      });
      toast({
        title: "Promoted",
        description: "Clip converted to a project annotation.",
      });
    } catch (error) {
      toast({
        title: "Promote failed",
        description: error instanceof Error ? error.message : "Could not promote web clip",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (clipId: string) => {
    if (!confirm("Delete this web clip?")) return;

    try {
      await deleteClip.mutateAsync(clipId);
      toast({ title: "Deleted", description: "Web clip removed." });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Could not delete web clip",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-eva-orange/20 bg-eva-dark/90 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/projects">
              <Button variant="ghost" size="icon" data-testid="button-back-projects">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="eva-section-title text-lg">WEB CLIPS</h1>
          </div>
          <div className="text-xs text-muted-foreground">{clips.length} clips loaded</div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 pb-10 space-y-4 eva-grid-bg">
        <Card className="eva-clip-panel eva-corner-decor">
          <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-4 gap-3">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search clips..."
              data-testid="input-web-clips-search"
            />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger data-testid="select-web-clips-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger data-testid="select-web-clips-project-filter">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={promoteProjectId || "none"} onValueChange={(value) => setPromoteProjectId(value === "none" ? "" : value)}>
              <SelectTrigger data-testid="select-web-clips-promote-target">
                <SelectValue placeholder="Promote target" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Promote target: clip/default</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    Promote target: {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4">
            {[1, 2, 3].map((index) => (
              <Card key={index} className="h-44 animate-pulse bg-muted/40" />
            ))}
          </div>
        ) : isError ? (
          <Card className="eva-clip-panel">
            <CardContent className="pt-6 text-sm text-eva-red">
              Failed to load web clips.
            </CardContent>
          </Card>
        ) : clips.length === 0 ? (
          <Card className="eva-clip-panel">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No clips found for the current filters.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {clips.map((clip) => (
              <Card key={clip.id} className="eva-clip-panel eva-corner-decor">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-2 min-w-0">
                      <CardTitle className="text-base leading-tight break-words">{clip.pageTitle}</CardTitle>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="uppercase tracking-wider text-[10px]">
                          {clip.category}
                        </Badge>
                        {clip.siteName && <span>{clip.siteName}</span>}
                        {clip.publishDate && <span>{clip.publishDate}</span>}
                        <span>{new Date(clip.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <a
                      href={clip.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-eva-orange hover:underline shrink-0"
                    >
                      Source
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <blockquote className="border-l-2 border-eva-blue pl-3 text-sm italic leading-relaxed whitespace-pre-wrap">
                    {clip.highlightedText}
                  </blockquote>

                  {clip.note && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{clip.note}</p>}

                  {clip.footnote && (
                    <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
                      {clip.footnote}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopyCitation(clip)}
                      data-testid={`button-web-clip-copy-${clip.id}`}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1.5" />
                      Copy Citation
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePromote(clip)}
                      disabled={promoteClip.isPending}
                      data-testid={`button-web-clip-promote-${clip.id}`}
                    >
                      <Send className="h-3.5 w-3.5 mr-1.5" />
                      Promote
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(clip.id)}
                      disabled={deleteClip.isPending}
                      data-testid={`button-web-clip-delete-${clip.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
