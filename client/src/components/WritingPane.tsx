import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { useProjects, useProjectDocuments } from "@/hooks/useProjects";
import {
  useWritingPipeline,
  type WritingRequest,
  type SavedPaper,
} from "@/hooks/useWriting";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  PenTool,
  RotateCcw,
  StopCircle,
} from "lucide-react";

interface WritingPaneProps {
  initialProjectId?: string;
  lockProject?: boolean;
}

interface GeneratedPaper {
  id: string;
  topic: string;
  content: string;
  createdAt: number;
  savedPaper: SavedPaper | null;
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[>*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toSafeFilename(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "generated-paper"
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function buildDocxBlob(title: string, content: string): Promise<Blob> {
  const lines = `${title}\n\n${content}`
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const paragraphs = lines
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml);
  zip.folder("_rels")?.file(".rels", relsXml);
  zip.folder("word")?.file("document.xml", documentXml);
  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function wrapText(text: string, maxWidth: number, font: any, size: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function buildPdfBlob(title: string, content: string): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const bodyFont = await pdf.embedFont(StandardFonts.TimesRoman);
  const headingFont = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 48;
  const maxWidth = pageWidth - margin * 2;
  const bodySize = 11;
  const titleSize = 15;
  const lineHeight = 15;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const draw = (line: string, size: number, font: any) => {
    if (y <= margin) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(line, { x: margin, y, size, font, color: rgb(0.08, 0.08, 0.08) });
    y -= lineHeight;
  };

  for (const line of wrapText(title, maxWidth, headingFont, titleSize)) {
    draw(line, titleSize, headingFont);
  }
  y -= lineHeight;

  for (const paragraph of content.split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    for (const line of wrapText(paragraph, maxWidth, bodyFont, bodySize)) {
      draw(line, bodySize, bodyFont);
    }
    y -= 6;
  }

  return new Blob([await pdf.save()], { type: "application/pdf" });
}

function getDocTypeLabel(filename: string): string {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf")) return "PDF";
  if (name.endsWith(".txt")) return "TXT";
  if (/\.(png|jpg|jpeg|webp|gif|bmp|tif|tiff|heic|heif)$/i.test(name)) return "IMAGE";
  return "DOC";
}

export default function WritingPane({
  initialProjectId,
  lockProject = false,
}: WritingPaneProps) {
  const { toast } = useToast();
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const lastCompletedTextRef = useRef("");
  const latestPaperIdRef = useRef<string | null>(null);
  const autoSelectedProjectsRef = useRef<Set<string>>(new Set());

  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId || "");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<"academic" | "casual" | "ap_style">("academic");
  const [targetLength, setTargetLength] = useState<"short" | "medium" | "long">("medium");
  const [citationStyle, setCitationStyle] = useState<"mla" | "apa" | "chicago">("chicago");
  const [selectedSourceDocumentIds, setSelectedSourceDocumentIds] = useState<string[]>([]);
  const [noEnDashes, setNoEnDashes] = useState(false);
  const [deepWrite, setDeepWrite] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(true);
  const [generatedPapers, setGeneratedPapers] = useState<GeneratedPaper[]>([]);
  const [selectedPaperId, setSelectedPaperId] = useState("");
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [isPreparingDocx, setIsPreparingDocx] = useState(false);

  const {
    generate,
    cancel,
    reset,
    status,
    phase,
    plan,
    sections,
    fullText,
    isGenerating,
    error,
    savedPaper,
  } = useWritingPipeline();

  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: projectSources = [], isLoading: projectSourcesLoading } = useProjectDocuments(
    selectedProjectId || ""
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  useEffect(() => {
    if (lockProject && initialProjectId) {
      setSelectedProjectId(initialProjectId);
      return;
    }
    if (initialProjectId && !selectedProjectId) {
      setSelectedProjectId(initialProjectId);
      return;
    }
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
  }, [initialProjectId, lockProject, projects, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedSourceDocumentIds([]);
      return;
    }
    const sourceIds = projectSources.map((source) => source.id);
    if (!autoSelectedProjectsRef.current.has(selectedProjectId) && sourceIds.length > 0) {
      autoSelectedProjectsRef.current.add(selectedProjectId);
      setSelectedSourceDocumentIds(sourceIds);
      return;
    }
    setSelectedSourceDocumentIds((prev) => prev.filter((id) => sourceIds.includes(id)));
  }, [projectSources, selectedProjectId]);

  useEffect(() => {
    if (rightPanelRef.current && (sections.length > 0 || fullText)) {
      rightPanelRef.current.scrollTop = rightPanelRef.current.scrollHeight;
    }
  }, [sections, fullText]);

  useEffect(() => {
    const trimmed = fullText.trim();
    if (!trimmed || trimmed === lastCompletedTextRef.current) return;
    const paperId = `paper-${Date.now()}`;
    latestPaperIdRef.current = paperId;
    lastCompletedTextRef.current = trimmed;
    setGeneratedPapers((prev) => [
      {
        id: paperId,
        topic: currentPrompt || topic.trim() || "Generated Paper",
        content: trimmed,
        createdAt: Date.now(),
        savedPaper: null,
      },
      ...prev,
    ]);
    setSelectedPaperId(paperId);
  }, [currentPrompt, fullText, topic]);

  useEffect(() => {
    if (!savedPaper || !latestPaperIdRef.current) return;
    setGeneratedPapers((prev) =>
      prev.map((paper) =>
        paper.id === latestPaperIdRef.current ? { ...paper, savedPaper } : paper
      )
    );
    if (selectedProjectId) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "documents"] });
    }
    toast({ title: "Saved to Project", description: savedPaper.filename });
  }, [savedPaper, selectedProjectId, toast]);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    };
  }, [pdfPreviewUrl]);

  const streamingContent = fullText || sections.map((section) => section.content).join("\n\n");
  const selectedPaper = useMemo(() => {
    if (!generatedPapers.length) return null;
    if (!selectedPaperId) return generatedPapers[0];
    return generatedPapers.find((paper) => paper.id === selectedPaperId) || generatedPapers[0];
  }, [generatedPapers, selectedPaperId]);

  const activeContent = isGenerating ? streamingContent : selectedPaper?.content || streamingContent;
  const activeTopic = isGenerating ? currentPrompt : selectedPaper?.topic || currentPrompt || "Generated Paper";
  const activeSavedPaper = isGenerating ? null : selectedPaper?.savedPaper || null;
  const plainText = useMemo(() => stripMarkdown(activeContent), [activeContent]);
  const wordCount = useMemo(() => (plainText ? plainText.split(/\s+/).filter(Boolean).length : 0), [plainText]);
  const pageEstimate = useMemo(() => (wordCount > 0 ? Math.max(1, Math.round(wordCount / 500)) : 0), [wordCount]);

  const progressPercent = plan
    ? phase === "complete"
      ? 100
      : phase === "stitching"
        ? 90
        : Math.round((sections.length / Math.max(1, plan.sections.length)) * 80) + 10
    : phase === "planning"
      ? 5
      : 0;

  const clearPdfPreview = () => {
    if (pdfPreviewUrl) {
      URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl(null);
    }
  };

  const handleGenerate = () => {
    if (!selectedProjectId) {
      toast({ title: "Project Required", description: "Select a project first.", variant: "destructive" });
      return;
    }
    if (!topic.trim()) {
      toast({ title: "Topic Required", description: "Enter a topic or prompt.", variant: "destructive" });
      return;
    }
    if (selectedSourceDocumentIds.length === 0) {
      toast({ title: "No Sources Selected", description: "Select at least one source.", variant: "destructive" });
      return;
    }

    clearPdfPreview();
    setShowPdfPreview(false);
    setCurrentPrompt(topic.trim());

    const request: WritingRequest = {
      topic: topic.trim(),
      annotationIds: [],
      sourceDocumentIds: selectedSourceDocumentIds,
      projectId: selectedProjectId,
      citationStyle,
      tone,
      targetLength,
      noEnDashes,
      deepWrite,
    };
    generate(request);
  };

  const handleReset = () => {
    clearPdfPreview();
    setShowPdfPreview(false);
    reset();
    setTopic("");
    setCurrentPrompt("");
  };

  const handleCopy = async () => {
    if (!activeContent) {
      toast({ title: "Nothing to copy", variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(activeContent);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleDownloadDocx = async () => {
    if (!activeContent) return;
    setIsPreparingDocx(true);
    try {
      const blob = await buildDocxBlob(activeTopic, stripMarkdown(activeContent));
      downloadBlob(blob, `${toSafeFilename(activeTopic)}.docx`);
    } catch (downloadError) {
      toast({
        title: "DOCX Export Failed",
        description: downloadError instanceof Error ? downloadError.message : "Could not export DOCX.",
        variant: "destructive",
      });
    } finally {
      setIsPreparingDocx(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!activeContent) return;
    setIsPreparingPdf(true);
    try {
      const blob = await buildPdfBlob(activeTopic, stripMarkdown(activeContent));
      downloadBlob(blob, `${toSafeFilename(activeTopic)}.pdf`);
    } catch (downloadError) {
      toast({
        title: "PDF Export Failed",
        description: downloadError instanceof Error ? downloadError.message : "Could not export PDF.",
        variant: "destructive",
      });
    } finally {
      setIsPreparingPdf(false);
    }
  };

  const handleTogglePdfPreview = async () => {
    if (!activeContent) return;
    if (showPdfPreview) {
      setShowPdfPreview(false);
      clearPdfPreview();
      return;
    }
    setIsPreparingPdf(true);
    try {
      const blob = await buildPdfBlob(activeTopic, stripMarkdown(activeContent));
      clearPdfPreview();
      setPdfPreviewUrl(URL.createObjectURL(blob));
      setShowPdfPreview(true);
    } catch (previewError) {
      toast({
        title: "Preview Failed",
        description: previewError instanceof Error ? previewError.message : "Could not generate preview.",
        variant: "destructive",
      });
    } finally {
      setIsPreparingPdf(false);
    }
  };

  const toggleSource = (projectDocumentId: string) => {
    setSelectedSourceDocumentIds((prev) =>
      prev.includes(projectDocumentId)
        ? prev.filter((id) => id !== projectDocumentId)
        : [...prev, projectDocumentId]
    );
  };

  const toggleAllSources = () => {
    if (selectedSourceDocumentIds.length === projectSources.length) {
      setSelectedSourceDocumentIds([]);
      return;
    }
    setSelectedSourceDocumentIds(projectSources.map((source) => source.id));
  };

  return (
    <div className="h-full min-h-0 flex flex-col md:flex-row border border-border rounded-lg overflow-hidden bg-background">
      <aside className="w-full md:w-2/5 lg:w-[38%] border-b md:border-b-0 md:border-r border-border bg-[#FDFAF4] dark:bg-muted/20 min-h-0">
        <div className="h-full min-h-0 overflow-y-auto p-4 space-y-4">
          <Card className="border-border bg-card/85">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <PenTool className="h-4 w-4 text-primary" />
                Writing Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Project</Label>
                {lockProject ? (
                  <div className="rounded-md border px-3 py-2 text-sm font-mono uppercase tracking-wider">
                    {selectedProject?.name || "Current Project"}
                  </div>
                ) : (
                  <Select
                    value={selectedProjectId}
                    onValueChange={setSelectedProjectId}
                    disabled={projectsLoading || isGenerating}
                  >
                    <SelectTrigger data-testid="select-writing-project">
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider">
                  Active source bank: {selectedProject?.name || "None selected"}
                </p>
              </div>

              <div className="space-y-2">
                <button type="button" className="w-full flex items-center justify-between" onClick={() => setSourcesExpanded((v) => !v)}>
                  <Label className="cursor-pointer">
                    Sources ({selectedSourceDocumentIds.length}/{projectSources.length})
                  </Label>
                  {sourcesExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {sourcesExpanded && (
                  <>
                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={toggleAllSources} disabled={projectSources.length === 0 || isGenerating}>
                        {selectedSourceDocumentIds.length === projectSources.length ? "Deselect all" : "Select all"}
                      </Button>
                    </div>
                    <ScrollArea className="h-40 border rounded-md p-2">
                      {projectSourcesLoading ? (
                        <p className="text-xs text-muted-foreground">Loading project sources...</p>
                      ) : projectSources.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No source documents in this project.</p>
                      ) : (
                        <div className="space-y-2">
                          {projectSources.map((source) => (
                            <label key={source.id} className="flex gap-2 rounded-md p-1.5 hover:bg-muted/40 cursor-pointer">
                              <Checkbox checked={selectedSourceDocumentIds.includes(source.id)} onCheckedChange={() => toggleSource(source.id)} disabled={isGenerating} className="mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium truncate">{source.document.filename}</span>
                                  <Badge variant="outline" className="text-[10px]">{getDocTypeLabel(source.document.filename)}</Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                                  {source.document.summary || "No summary available for this source."}
                                </p>
                              </div>
                            </label>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="writing-topic">Topic / Prompt</Label>
                <Textarea
                  id="writing-topic"
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="Describe what you want written, your thesis, and argument strategy."
                  className="min-h-[96px] resize-none"
                  disabled={isGenerating}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tone</Label>
                  <Select value={tone} onValueChange={(v) => setTone(v as typeof tone)} disabled={isGenerating}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="academic">Academic</SelectItem>
                      <SelectItem value="casual">Casual</SelectItem>
                      <SelectItem value="ap_style">AP Style</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Length</Label>
                  <Select value={targetLength} onValueChange={(v) => setTargetLength(v as typeof targetLength)} disabled={isGenerating}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="short">Short (~3 pages)</SelectItem>
                      <SelectItem value="medium">Medium (~5 pages)</SelectItem>
                      <SelectItem value="long">Long (~8 pages)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Citation Style</Label>
                <Select value={citationStyle} onValueChange={(v) => setCitationStyle(v as typeof citationStyle)} disabled={isGenerating}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chicago">Chicago</SelectItem>
                    <SelectItem value="mla">MLA</SelectItem>
                    <SelectItem value="apa">APA</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider">
                  <Checkbox checked={noEnDashes} onCheckedChange={(v) => setNoEnDashes(Boolean(v))} disabled={isGenerating} />
                  No en-dashes
                </label>
                <label className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider">
                  <Checkbox checked={deepWrite} onCheckedChange={(v) => setDeepWrite(Boolean(v))} disabled={isGenerating} />
                  Deep Write
                </label>
              </div>

              {(isGenerating || phase) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : error ? <AlertCircle className="h-3.5 w-3.5 text-destructive" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                    <span className="text-muted-foreground">{status}</span>
                  </div>
                  {isGenerating && <Progress value={progressPercent} className="h-1.5" />}
                </div>
              )}

              {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

              <div className="flex items-center gap-2">
                {!isGenerating ? (
                  <Button onClick={handleGenerate} className="flex-1" data-testid="button-generate-paper">
                    <FileText className="h-4 w-4 mr-2" />
                    Generate Paper
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={cancel} className="flex-1">
                    <StopCircle className="h-4 w-4 mr-2" />
                    Stop
                  </Button>
                )}
                <Button variant="outline" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/85">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono uppercase tracking-wider">Writing Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-56 pr-2">
                <div className="space-y-3">
                  {generatedPapers.map((paper) => (
                    <div key={paper.id} className="space-y-1.5">
                      <div className="ml-auto max-w-[90%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs">{paper.topic}</div>
                      <div className="max-w-[92%] rounded-lg border border-border bg-background px-3 py-2 text-xs space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">Done</span>
                          <span className="text-[10px] text-muted-foreground">{new Date(paper.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {paper.savedPaper ? `Saved as ${paper.savedPaper.filename}` : "Generated in this session"}
                        </p>
                      </div>
                    </div>
                  ))}

                  {currentPrompt && (isGenerating || !!error) && (
                    <div className="space-y-1.5">
                      <div className="ml-auto max-w-[90%] rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs">{currentPrompt}</div>
                      <div className="max-w-[92%] rounded-lg border border-border bg-background px-3 py-2 text-xs">{isGenerating ? status || "Generating..." : error || "Generation failed"}</div>
                    </div>
                  )}

                  {!generatedPapers.length && !currentPrompt && (
                    <p className="text-xs text-muted-foreground">Prompt and generation status history appears here.</p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </aside>

      <section className="flex-1 min-h-0 flex flex-col bg-[#F7F2EA] dark:bg-background">
        <div className="border-b border-border px-4 py-3 bg-background/80 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {generatedPapers.length > 1 && !isGenerating && (
                <Select value={selectedPaper?.id || ""} onValueChange={setSelectedPaperId}>
                  <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select draft" /></SelectTrigger>
                  <SelectContent>
                    {generatedPapers.map((paper) => (
                      <SelectItem key={paper.id} value={paper.id}>{paper.topic.slice(0, 45)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Badge variant="outline" className="font-mono text-[10px] uppercase">{wordCount} words</Badge>
              <Badge variant="outline" className="font-mono text-[10px] uppercase">{pageEstimate} page{pageEstimate === 1 ? "" : "s"}</Badge>
              {activeSavedPaper && <Badge variant="secondary" className="font-mono text-[10px] uppercase">Saved to project</Badge>}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleCopy} disabled={!activeContent}><Copy className="h-4 w-4 mr-2" />Copy</Button>
              <Button variant="outline" size="sm" onClick={handleDownloadDocx} disabled={!activeContent || isPreparingDocx}>
                {isPreparingDocx ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                DOCX
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={!activeContent || isPreparingPdf}>
                {isPreparingPdf ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                PDF
              </Button>
              <Button variant="outline" size="sm" onClick={handleTogglePdfPreview} disabled={!activeContent || isPreparingPdf}>
                {showPdfPreview ? <><EyeOff className="h-4 w-4 mr-2" />Hide Preview</> : <><Eye className="h-4 w-4 mr-2" />Preview PDF</>}
              </Button>
            </div>
          </div>
        </div>

        <div ref={rightPanelRef} className="flex-1 min-h-0 overflow-auto p-4 md:p-6">
          {!activeContent && !isGenerating && !error && (
            <div className="h-full min-h-[260px] flex items-center justify-center">
              <div className="text-center space-y-2 max-w-md">
                <PenTool className="h-12 w-12 mx-auto text-primary/60" />
                <p className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
                  Select a project and enter a topic to start writing
                </p>
              </div>
            </div>
          )}

          {isGenerating && !activeContent && (
            <div className="space-y-4 animate-pulse">
              <div className="h-6 w-2/5 bg-muted rounded" />
              <div className="h-4 w-full bg-muted rounded" />
              <div className="h-4 w-[92%] bg-muted rounded" />
              <div className="h-4 w-[88%] bg-muted rounded" />
            </div>
          )}

          {activeContent && (
            <>
              {showPdfPreview && pdfPreviewUrl ? (
                <div className="h-full min-h-[560px] border border-border rounded-md overflow-hidden bg-white">
                  <iframe src={pdfPreviewUrl} title="Generated PDF Preview" className="w-full h-full min-h-[560px]" />
                </div>
              ) : (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{activeContent}</ReactMarkdown>
                  {isGenerating && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
