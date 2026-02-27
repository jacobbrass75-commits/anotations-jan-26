import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useProjects, useCreateProject, useDeleteProject } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, FolderOpen, FileText, Trash2, ArrowLeft, Search, PenTool } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Projects() {
  const [, setLocation] = useLocation();
  const { data: projects, isLoading } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();
  const { toast } = useToast();
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProject, setNewProject] = useState({
    name: "",
    description: "",
    thesis: "",
    scope: "",
  });

  const handleCreate = async () => {
    if (!newProject.name.trim()) {
      toast({ title: "Error", description: "Project name is required", variant: "destructive" });
      return;
    }
    
    try {
      const project = await createProject.mutateAsync(newProject);
      setIsCreateOpen(false);
      setNewProject({ name: "", description: "", thesis: "", scope: "" });
      toast({ title: "Success", description: "Project created successfully" });
      setLocation(`/projects/${project.id}`);
    } catch (error) {
      toast({ title: "Error", description: "Failed to create project", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!confirm("Are you sure you want to delete this project? This action cannot be undone.")) {
      return;
    }
    
    try {
      await deleteProject.mutateAsync(id);
      toast({ title: "Success", description: "Project deleted" });
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete project", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 eva-grid-bg">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 bg-muted rounded" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-48 bg-muted rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="eva-section-title text-lg">RESEARCH PROJECTS</h1>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/write">
              <Button variant="outline" className="uppercase tracking-wider text-xs font-mono" data-testid="button-open-write">
                <PenTool className="h-4 w-4 mr-2" />
                Write
              </Button>
            </Link>
            <Link href="/web-clips">
              <Button variant="outline" className="uppercase tracking-wider text-xs font-mono" data-testid="button-open-web-clips">
                Web Clips
              </Button>
            </Link>

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="uppercase tracking-wider" data-testid="button-create-project">
                  <Plus className="h-4 w-4 mr-2" />
                  New Project
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create New Project</DialogTitle>
                  <DialogDescription>
                    Define your research project. The thesis and scope help optimize AI-assisted search.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Project Name</Label>
                    <Input
                      id="name"
                      value={newProject.name}
                      onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                      placeholder="e.g., Victorian Literature Analysis"
                      data-testid="input-project-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description (optional)</Label>
                    <Textarea
                      id="description"
                      value={newProject.description}
                      onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                      placeholder="Brief description of your research project"
                      className="resize-none"
                      data-testid="input-project-description"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="thesis">Research Thesis / Question</Label>
                    <Textarea
                      id="thesis"
                      value={newProject.thesis}
                      onChange={(e) => setNewProject({ ...newProject, thesis: e.target.value })}
                      placeholder="What is your main research question or thesis statement?"
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
                      placeholder="Define the boundaries of your research"
                      className="resize-none"
                      data-testid="input-project-scope"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)} data-testid="button-cancel-create">
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={createProject.isPending} data-testid="button-confirm-create">
                    {createProject.isPending ? "Creating..." : "Create Project"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 pb-8 eva-grid-bg">
        {projects && projects.length === 0 ? (
          <div className="text-center py-16 space-y-4">
            <FolderOpen className="h-16 w-16 mx-auto text-primary" />
            <h2 className="eva-section-title text-base">NO ACTIVE PROJECTS</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Create a research project to organize your documents, annotations, and enable global search across your entire collection.
            </p>
            <Button className="uppercase tracking-wider" onClick={() => setIsCreateOpen(true)} data-testid="button-create-first-project">
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects?.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="h-full hover-elevate cursor-pointer group eva-clip-panel eva-corner-decor hover:shadow-lg transition-all duration-200" data-testid={`card-project-${project.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg line-clamp-1 font-sans uppercase tracking-wider">{project.name}</CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => handleDelete(project.id, e)}
                        data-testid={`button-delete-project-${project.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive hover:text-destructive/80" />
                      </Button>
                    </div>
                    {project.description && (
                      <CardDescription className="line-clamp-2">{project.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {project.thesis && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Thesis: </span>
                        <span className="line-clamp-2">{project.thesis}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        <span>Documents</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Search className="h-3 w-3" />
                        <span>Search</span>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Created {new Date(project.createdAt).toLocaleDateString()}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
