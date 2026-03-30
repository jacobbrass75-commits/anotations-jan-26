import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, FileText, FolderOpen, Link2, MessageSquare, PenTool, Plus, Search, UserRound } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useCreateProject, useProjects } from "@/hooks/useProjects";

interface DashboardStatus {
  counts: {
    projects: number;
    documents: number;
    annotations: number;
  };
}

export default function Home() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const createProject = useCreateProject();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    description: "",
    thesis: "",
    scope: "",
  });

  const { data: dashboard } = useQuery<DashboardStatus>({
    queryKey: ["/api/system/status"],
    queryFn: async () => {
      const res = await fetch("/api/system/status");
      if (!res.ok) {
        throw new Error("Failed to fetch system status");
      }
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const recentProjects = useMemo(() => projects.slice(0, 3), [projects]);

  const handleCreateProject = async () => {
    if (!newProject.name.trim()) {
      toast({
        title: "Project name required",
        description: "Add a project name before creating it.",
        variant: "destructive",
      });
      return;
    }

    try {
      const project = await createProject.mutateAsync(newProject);
      setIsCreateOpen(false);
      setNewProject({ name: "", description: "", thesis: "", scope: "" });
      setLocation(`/projects/${project.id}`);
    } catch (error) {
      toast({
        title: "Create failed",
        description: error instanceof Error ? error.message : "Could not create project",
        variant: "destructive",
      });
    }
  };

  const projectsCount = dashboard?.counts.projects ?? projects.length;
  const documentsCount = dashboard?.counts.documents ?? 0;
  const annotationsCount = dashboard?.counts.annotations ?? 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <h1 className="font-sans uppercase tracking-[0.2em] font-bold text-primary">SCHOLARMARK</h1>
            <div className="eva-status-active" />
          </div>
          <div className="flex items-center gap-2">
            <Link href="/projects">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono" data-testid="button-projects">
                <FolderOpen className="h-4 w-4 mr-2" />
                Projects
              </Button>
            </Link>
            <Link href="/chat">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono" data-testid="button-chat">
                <MessageSquare className="h-4 w-4 mr-2" />
                Chat
              </Button>
            </Link>
            <Link href="/write">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono" data-testid="button-write">
                <PenTool className="h-4 w-4 mr-2" />
                Write
              </Button>
            </Link>
            <Link href="/web-clips">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono" data-testid="button-web-clips">
                <Link2 className="h-4 w-4 mr-2" />
                Web Clips
              </Button>
            </Link>
            <Link href="/account">
              <Button variant="outline" size="sm" className="uppercase tracking-wider text-xs font-mono" data-testid="button-account">
                <UserRound className="h-4 w-4 mr-2" />
                Account
              </Button>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 pb-8 space-y-6 eva-grid-bg">
        <Card className="eva-clip-panel eva-corner-decor border-border bg-card/80">
          <CardContent className="pt-8 pb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-3">
              <div className="eva-section-title">Research Workspace</div>
              <h2 className="text-3xl md:text-4xl font-sans uppercase tracking-[0.12em] text-primary leading-tight">
                ScholarMark Command Center
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Organize your sources, review evidence, and move from reading to writing in one workspace.
              </p>
              <div className="flex items-center gap-3 text-sm font-mono text-chart-2">
                <div className="flex items-center gap-1.5">
                  <div className="eva-status-active" />
                  <div className="eva-status-active" />
                  <div className="eva-status-active" />
                </div>
                <span>Workspace ready</span>
              </div>
            </div>

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button
                  className="h-14 px-8 text-sm font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-initialize-project"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  CREATE NEW PROJECT
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create New Project</DialogTitle>
                  <DialogDescription>
                    Define your research project. Thesis and scope improve annotation quality and retrieval.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Project Name</Label>
                    <Input
                      id="name"
                      value={newProject.name}
                      onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                      placeholder="e.g., Cold War Brainwashing Research"
                      data-testid="input-project-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={newProject.description}
                      onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                      className="resize-none"
                      data-testid="input-project-description"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="thesis">Thesis / Research Question</Label>
                    <Textarea
                      id="thesis"
                      value={newProject.thesis}
                      onChange={(e) => setNewProject({ ...newProject, thesis: e.target.value })}
                      className="resize-none"
                      data-testid="input-project-thesis"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="scope">Scope</Label>
                    <Textarea
                      id="scope"
                      value={newProject.scope}
                      onChange={(e) => setNewProject({ ...newProject, scope: e.target.value })}
                      className="resize-none"
                      data-testid="input-project-scope"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateProject} disabled={createProject.isPending}>
                    {createProject.isPending ? "Creating..." : "Create Project"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm eva-section-title flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-primary" />
                Projects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl text-chart-2">{projectsCount}</div>
            </CardContent>
          </Card>

          <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm eva-section-title flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl text-chart-3">{documentsCount}</div>
            </CardContent>
          </Card>

          <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm eva-section-title flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                Annotations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-mono text-3xl text-chart-2">{annotationsCount}</div>
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="eva-clip-panel eva-corner-decor bg-card/70 border-border">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="eva-section-title">Recent Projects</CardTitle>
              <Link href="/projects">
                <Button variant="ghost" className="text-xs uppercase tracking-[0.12em] font-mono text-primary" data-testid="button-view-all-projects">
                  VIEW ALL PROJECTS
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {projectsLoading ? (
                <div className="text-sm text-muted-foreground font-mono">Loading projects...</div>
              ) : recentProjects.length === 0 ? (
                <div className="text-sm text-muted-foreground font-mono">No projects yet. Create your first project to get started.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {recentProjects.map((project) => (
                    <Link key={project.id} href={`/projects/${project.id}`}>
                      <Card className="cursor-pointer hover-elevate eva-corner-decor bg-background/40 border-border">
                        <CardContent className="pt-4 pb-4 space-y-2">
                          <div className="font-sans uppercase tracking-[0.1em] text-sm line-clamp-2">{project.name}</div>
                          {project.description ? (
                            <p className="text-xs text-muted-foreground line-clamp-2">{project.description}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground">No description</p>
                          )}
                          <div className="text-[11px] font-mono text-chart-3">
                            {new Date(project.createdAt).toLocaleDateString()}
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
