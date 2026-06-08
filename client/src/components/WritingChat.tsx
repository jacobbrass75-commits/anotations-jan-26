import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "wouter";
import { useProjects, useProjectDocuments } from "@/hooks/useProjects";
import { useWebClips } from "@/hooks/useWebClips";
import { useWritingStyles } from "@/hooks/useWritingStyles";
import { markdownComponents, remarkPlugins } from "@/lib/markdownConfig";
import {
  useProjectConversations,
  useStandaloneConversations,
  useWritingConversation,
  useCreateWritingConversation,
  useDeleteWritingConversation,
  useUpdateWritingConversation,
  useUpdateSourceRole,
  useUpdateSources,
  useWritingSendMessage,
  useCompilePaper,
  useVerifyPaper,
} from "@/hooks/useWritingChat";
import { useHumanizeText } from "@/hooks/useHumanizer";
import { useWritingPipeline, type WritingRequest } from "@/hooks/useWriting";
import { queryClient } from "@/lib/queryClient";
import { getAuthHeaders } from "@/lib/auth";
import {
  stripMarkdown,
  buildDocxBlob,
  buildPdfBlob,
  downloadBlob,
  toSafeFilename,
  getDocTypeLabel,
} from "@/lib/documentExport";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { DocumentPanel } from "@/components/chat/DocumentPanel";
import { SourceRoleSelector, type SourceRole } from "@/components/SourceRoleSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Lightbulb,
  Loader2,
  PenLine,
  PenTool,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Zap,
} from "lucide-react";

interface WritingChatProps {
  initialProjectId?: string;
  lockProject?: boolean;
}

const NO_PROJECT_VALUE = "__no_project__";
const NO_STYLE_VALUE = "__no_style__";
const DEFAULT_SOURCE_ROLE: SourceRole = "evidence";

function getGeneratedPaperTitle(prompt: string, fallback?: string): string {
  const firstLine = prompt
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  const title = firstLine || fallback || "Generated Paper";
  return title.replace(/^["']|["']$/g, "").slice(0, 90);
}

function normalizeSourceRole(value: string | null | undefined): SourceRole {
  return value === "style_reference" || value === "background" || value === "evidence"
    ? value
    : DEFAULT_SOURCE_ROLE;
}

const WRITING_PROMPTS = [
  {
    icon: PenLine,
    label: "Write the introduction",
    prompt: "Write an introduction paragraph for my paper. Include a thesis statement based on the sources.",
  },
  {
    icon: BookOpen,
    label: "Draft a thesis statement",
    prompt: "Help me craft a strong thesis statement for my paper based on the available source materials.",
  },
  {
    icon: FileText,
    label: "Write a section",
    prompt: "Write a section analyzing the key arguments from the sources. Include proper citations.",
  },
  {
    icon: Lightbulb,
    label: "Write the conclusion",
    prompt: "Write a conclusion that ties together the main arguments of my paper.",
  },
];

export default function WritingChat({ initialProjectId, lockProject }: WritingChatProps) {
  const { toast } = useToast();

  // Project selection
  const { data: projects = [] } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialProjectId || (lockProject ? "" : NO_PROJECT_VALUE)
  );
  const hasSelectedProject = Boolean(selectedProjectId && selectedProjectId !== NO_PROJECT_VALUE);

  // If project is locked and no initial project is available yet, select the first loaded project.
  useEffect(() => {
    if (lockProject && !selectedProjectId && projects.length > 0) {
      setSelectedProjectId(initialProjectId || projects[0].id);
    }
  }, [initialProjectId, lockProject, projects, selectedProjectId]);

  const selectedProject = useMemo(
    () => (hasSelectedProject ? projects.find((p) => p.id === selectedProjectId) : undefined),
    [hasSelectedProject, projects, selectedProjectId]
  );
  const { data: writingStyles = [], isLoading: writingStylesLoading } = useWritingStyles();

  // Conversation management
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const { data: projectConversations = [] } = useProjectConversations(
    hasSelectedProject ? selectedProjectId : undefined
  );
  const { data: standaloneConversations = [] } = useStandaloneConversations(!hasSelectedProject);
  const conversations = hasSelectedProject ? projectConversations : standaloneConversations;
  const { data: conversationData } = useWritingConversation(activeConversationId);
  const createConversation = useCreateWritingConversation();
  const deleteConversation = useDeleteWritingConversation();
  const updateConversation = useUpdateWritingConversation();
  const updateSourceRole = useUpdateSourceRole();
  const updateSources = useUpdateSources();

  const messages = conversationData?.messages || [];
  const {
    send,
    streamingText,
    streamingChatText,
    documentTitle,
    streamingDocumentText,
    isDocumentStreaming,
    isDocumentComplete,
    isStreaming,
    contextLoading,
    contextWarning,
    streamError,
    streamStatus,
  } = useWritingSendMessage(activeConversationId);

  // Source management
  const { data: projectSources = [], isLoading: projectSourcesLoading } = useProjectDocuments(
    hasSelectedProject ? selectedProjectId : ""
  );
  const { data: standaloneWebClips = [], isLoading: webClipsLoading } = useWebClips({}, !hasSelectedProject);
  const sourcesLoading = hasSelectedProject ? projectSourcesLoading : webClipsLoading;
  const projectSourceIds = useMemo(() => projectSources.map((source) => source.id), [projectSources]);
  const webClipSourceIds = useMemo(() => standaloneWebClips.map((clip) => clip.id), [standaloneWebClips]);
  const sourceIds = hasSelectedProject ? projectSourceIds : webClipSourceIds;
  const [localSelectedSourceIds, setLocalSelectedSourceIds] = useState<string[]>([]);
  const [sourcesExpanded, setSourcesExpanded] = useState(true);
  const autoSelectedRef = useRef<Set<string>>(new Set());

  // Sync source selection from conversation
  useEffect(() => {
    if (conversationData?.selectedSourceIds) {
      setLocalSelectedSourceIds(conversationData.selectedSourceIds);
    }
  }, [conversationData?.selectedSourceIds]);

  useEffect(() => {
    if (
      !hasSelectedProject ||
      activeConversationId ||
      projectSourceIds.length === 0 ||
      autoSelectedRef.current.has(selectedProjectId)
    ) {
      return;
    }

    autoSelectedRef.current.add(selectedProjectId);
    setLocalSelectedSourceIds(projectSourceIds);
  }, [activeConversationId, hasSelectedProject, projectSourceIds, selectedProjectId]);

  // Writing settings
  const [citationStyle, setCitationStyle] = useState(conversationData?.citationStyle || "chicago");
  const [tone, setTone] = useState(conversationData?.tone || "academic");
  const [writingModel, setWritingModel] = useState<"precision" | "extended">(
    conversationData?.writingModel === "extended" ? "extended" : "precision"
  );
  const [humanize, setHumanize] = useState(conversationData?.humanize ?? true);
  const [noEnDashes, setNoEnDashes] = useState(conversationData?.noEnDashes || false);
  const [selectedWritingStyleId, setSelectedWritingStyleId] = useState<string>(NO_STYLE_VALUE);
  const selectedWritingStyle = useMemo(
    () => writingStyles.find((style) => style.id === selectedWritingStyleId) || null,
    [selectedWritingStyleId, writingStyles],
  );

  // Document history / panel
  const [documents, setDocuments] = useState<Array<{ title: string; content: string }>>([]);
  const [selectedDocIndex, setSelectedDocIndex] = useState<number | null>(null);
  const documentPanelRef = useRef<HTMLElement | null>(null);
  const lastCompletedDocumentKeyRef = useRef("");

  // Sync settings from conversation
  useEffect(() => {
    if (conversationData) {
      if (conversationData.citationStyle) setCitationStyle(conversationData.citationStyle);
      if (conversationData.tone) setTone(conversationData.tone);
      setWritingModel(conversationData.writingModel === "extended" ? "extended" : "precision");
      if (conversationData.humanize !== undefined && conversationData.humanize !== null) {
        setHumanize(conversationData.humanize);
      }
      if (conversationData.noEnDashes !== undefined && conversationData.noEnDashes !== null) {
        setNoEnDashes(conversationData.noEnDashes);
      }
      setSelectedWritingStyleId(conversationData.writingStyleId || NO_STYLE_VALUE);
    }
  }, [conversationData]);

  useEffect(() => {
    if (selectedWritingStyleId === NO_STYLE_VALUE) return;
    if (!writingStyles.some((style) => style.id === selectedWritingStyleId)) {
      setSelectedWritingStyleId(NO_STYLE_VALUE);
    }
  }, [selectedWritingStyleId, writingStyles]);

  useEffect(() => {
    if (writingStylesLoading || selectedWritingStyleId !== NO_STYLE_VALUE) return;
    if (conversationData?.writingStyleId) return;
    if (writingStyles.length === 1) {
      setSelectedWritingStyleId(writingStyles[0].id);
    }
  }, [conversationData?.writingStyleId, selectedWritingStyleId, writingStyles, writingStylesLoading]);

  useEffect(() => {
    if (!contextWarning) return;
    toast({
      title: "Context Warning",
      description: contextWarning.message,
      variant: "destructive",
    });
  }, [contextWarning, toast]);

  useEffect(() => {
    if (!streamError) return;
    toast({
      title: "Writing failed",
      description: streamError.message,
      variant: "destructive",
    });
  }, [streamError, toast]);

  useEffect(() => {
    // Reset document panel state when switching conversations.
    setDocuments([]);
    setSelectedDocIndex(null);
    lastCompletedDocumentKeyRef.current = "";
    lastQuickGenerateDocumentKeyRef.current = "";
  }, [activeConversationId]);

  useEffect(() => {
    if (isDocumentStreaming || !isDocumentComplete || !streamingDocumentText.trim()) {
      return;
    }

    const key = `${documentTitle}\n${streamingDocumentText}`;
    if (key === lastCompletedDocumentKeyRef.current) {
      return;
    }

    lastCompletedDocumentKeyRef.current = key;
    setDocuments((prev) => {
      const next = [...prev, { title: documentTitle || "Draft", content: streamingDocumentText }];
      setSelectedDocIndex(next.length - 1);
      return next;
    });
  }, [documentTitle, isDocumentComplete, isDocumentStreaming, streamingDocumentText]);

  // Compile & Verify
  const { compile, cancelCompile, clearCompiled, compiledContent, isCompiling } = useCompilePaper(activeConversationId);
  const { verify, verifyReport, isVerifying } = useVerifyPaper(activeConversationId);
  const humanizeText = useHumanizeText();
  const [humanizedCompiledContent, setHumanizedCompiledContent] = useState<string | null>(null);

  // PDF preview
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [isPreparingPdf, setIsPreparingPdf] = useState(false);
  const [isPreparingDocx, setIsPreparingDocx] = useState(false);
  const [showControlsWhenDocument, setShowControlsWhenDocument] = useState(true);

  // Quick Generate dialog
  const [quickGenerateOpen, setQuickGenerateOpen] = useState(false);
  const [quickTopic, setQuickTopic] = useState("");
  const [quickAssignmentInstructions, setQuickAssignmentInstructions] = useState("");
  const [quickTargetLength, setQuickTargetLength] = useState<"short" | "medium" | "long">("medium");
  const [quickDeepWrite, setQuickDeepWrite] = useState(false);
  const quickGenerate = useWritingPipeline();
  const lastQuickGenerateDocumentKeyRef = useRef("");

  // Computed
  const effectiveCompiledContent = humanizedCompiledContent ?? compiledContent;
  const plainText = useMemo(
    () => (effectiveCompiledContent ? stripMarkdown(effectiveCompiledContent) : ""),
    [effectiveCompiledContent]
  );
  const wordCount = useMemo(() => (plainText ? plainText.split(/\s+/).filter(Boolean).length : 0), [plainText]);
  const pageEstimate = useMemo(() => (wordCount > 0 ? Math.max(1, Math.round(wordCount / 500)) : 0), [wordCount]);
  const conversationProjectId = hasSelectedProject ? selectedProjectId : null;
  const generatedProjectDrafts = useMemo(
    () => projectSources.filter((source) => source.roleInProject === "AI-generated draft"),
    [projectSources]
  );
  const quickGenerateIsPartial = quickGenerate.phase === "partial";
  const quickGenerateTitle = useMemo(
    () => getGeneratedPaperTitle(quickTopic, quickGenerate.savedPaper?.filename),
    [quickGenerate.savedPaper?.filename, quickTopic]
  );
  const quickGenerateProgress = useMemo(() => {
    if (quickGenerate.fullText || quickGenerate.phase === "complete") return 100;
    if (quickGenerate.phase === "stitching") return 90;
    if (quickGenerate.plan) {
      return Math.min(
        95,
        Math.round((quickGenerate.sections.length / Math.max(1, quickGenerate.plan.sections.length)) * 80) + 10
      );
    }
    return quickGenerate.isGenerating ? 5 : 0;
  }, [
    quickGenerate.fullText,
    quickGenerate.isGenerating,
    quickGenerate.phase,
    quickGenerate.plan,
    quickGenerate.sections.length,
  ]);

  useEffect(() => {
    setHumanizedCompiledContent(null);
  }, [compiledContent]);

  useEffect(() => {
    if (!quickGenerate.error) return;
    toast({
      title: "Quick Generate failed",
      description: quickGenerate.error,
      variant: "destructive",
    });
  }, [quickGenerate.error, toast]);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    };
  }, [pdfPreviewUrl]);

  // --- Handlers ---

  const handleNewChat = useCallback(async () => {
    try {
      const conv = await createConversation.mutateAsync({
        projectId: conversationProjectId,
        selectedSourceIds: localSelectedSourceIds,
        writingStyleId: selectedWritingStyleId === NO_STYLE_VALUE ? null : selectedWritingStyleId,
        writingModel,
        citationStyle,
        tone,
        humanize,
        noEnDashes,
      });
      await updateConversation.mutateAsync({
        id: conv.id,
        data: {
          citationStyle,
          tone,
          writingModel,
          humanize,
          noEnDashes,
          writingStyleId: selectedWritingStyleId === NO_STYLE_VALUE ? null : selectedWritingStyleId,
        },
      });
      setActiveConversationId(conv.id);
      clearCompiled();
    } catch {
      toast({ title: "Error", description: "Failed to create conversation", variant: "destructive" });
    }
  }, [conversationProjectId, localSelectedSourceIds, selectedWritingStyleId, citationStyle, tone, writingModel, humanize, noEnDashes, createConversation, updateConversation, clearCompiled, toast]);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    clearCompiled();
  }, [clearCompiled]);

  const handleDeleteConversation = useCallback(async (id: string) => {
    try {
      await deleteConversation.mutateAsync(id);
      if (activeConversationId === id) {
        setActiveConversationId(null);
        clearCompiled();
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete conversation", variant: "destructive" });
    }
  }, [deleteConversation, activeConversationId, clearCompiled, toast]);

  const handleRenameConversation = useCallback(async (id: string, newTitle: string) => {
    try {
      await updateConversation.mutateAsync({ id, data: { title: newTitle } });
    } catch {
      toast({ title: "Error", description: "Failed to rename", variant: "destructive" });
    }
  }, [updateConversation, toast]);

  const handleSend = useCallback(async (content: string) => {
    setPendingUserMessage(content);
    if (!activeConversationId) {
      // Create a new conversation first
      try {
        const conv = await createConversation.mutateAsync({
          projectId: conversationProjectId,
          selectedSourceIds: localSelectedSourceIds,
          writingStyleId: selectedWritingStyleId === NO_STYLE_VALUE ? null : selectedWritingStyleId,
          writingModel,
          citationStyle,
          tone,
          humanize,
          noEnDashes,
        });
        setActiveConversationId(conv.id);

        // Save settings
        await updateConversation.mutateAsync({
          id: conv.id,
          data: {
            citationStyle,
            tone,
            writingModel,
            humanize,
            noEnDashes,
            writingStyleId: selectedWritingStyleId === NO_STYLE_VALUE ? null : selectedWritingStyleId,
          },
        });

        await send(content, conv.id);
      } catch {
        toast({ title: "Error", description: "Failed to start conversation", variant: "destructive" });
      } finally {
        setPendingUserMessage(null);
      }
      return;
    }

    try {
      await send(content);
    } finally {
      setPendingUserMessage(null);
    }
  }, [activeConversationId, conversationProjectId, localSelectedSourceIds, selectedWritingStyleId, citationStyle, tone, writingModel, humanize, noEnDashes, send, createConversation, updateConversation, toast]);

  const toggleSource = useCallback((id: string) => {
    setLocalSelectedSourceIds((prev) => {
      const next = prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      // Persist to server
      if (activeConversationId) {
        updateSources.mutate({ conversationId: activeConversationId, selectedSourceIds: next });
      }
      return next;
    });
  }, [activeConversationId, updateSources]);

  const toggleAllSources = useCallback(() => {
    const allIds = sourceIds;
    const allVisibleSourcesSelected = allIds.length > 0 && allIds.every((id) => localSelectedSourceIds.includes(id));
    const next = allVisibleSourcesSelected ? [] : allIds;
    setLocalSelectedSourceIds(next);
    if (activeConversationId) {
      updateSources.mutate({ conversationId: activeConversationId, selectedSourceIds: next });
    }
  }, [sourceIds, localSelectedSourceIds, activeConversationId, updateSources]);

  const handleSourceRoleChange = useCallback(async (sourceId: string, sourceRole: SourceRole) => {
    if (!hasSelectedProject) return;

    try {
      await updateSourceRole.mutateAsync({
        sourceId,
        projectId: selectedProjectId,
        sourceRole,
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to update source role",
        variant: "destructive",
      });
    }
  }, [hasSelectedProject, selectedProjectId, toast, updateSourceRole]);

  const handleSettingChange = useCallback((key: string, value: any) => {
    if (key === "citationStyle") setCitationStyle(value);
    if (key === "tone") setTone(value);
    if (key === "writingModel") setWritingModel(value);
    if (key === "humanize") setHumanize(value);
    if (key === "noEnDashes") setNoEnDashes(value);
    if (key === "writingStyleId") setSelectedWritingStyleId(value || NO_STYLE_VALUE);

    if (activeConversationId) {
      updateConversation.mutate({
        id: activeConversationId,
        data: { [key]: key === "writingStyleId" && value === NO_STYLE_VALUE ? null : value },
      });
    }
  }, [activeConversationId, updateConversation]);

  const handleCompile = useCallback(() => {
    compile({ citationStyle, tone, noEnDashes });
  }, [compile, citationStyle, tone, noEnDashes]);

  const handleVerify = useCallback(() => {
    if (effectiveCompiledContent) verify(effectiveCompiledContent);
  }, [verify, effectiveCompiledContent]);

  const handleCopy = useCallback(async () => {
    if (!effectiveCompiledContent) return;
    try {
      await navigator.clipboard.writeText(effectiveCompiledContent);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  }, [effectiveCompiledContent, toast]);

  const handleDownloadDocx = useCallback(async () => {
    if (!effectiveCompiledContent) return;
    setIsPreparingDocx(true);
    try {
      const blob = await buildDocxBlob(conversationData?.title || "Paper", effectiveCompiledContent);
      downloadBlob(blob, `${toSafeFilename(conversationData?.title || "Paper")}.docx`);
    } catch (e) {
      toast({ title: "Export failed", description: e instanceof Error ? e.message : "DOCX export failed", variant: "destructive" });
    } finally {
      setIsPreparingDocx(false);
    }
  }, [effectiveCompiledContent, conversationData, toast]);

  const handleTogglePdfPreview = useCallback(async () => {
    if (!effectiveCompiledContent) return;
    if (showPdfPreview) {
      setShowPdfPreview(false);
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl(null);
      return;
    }
    setIsPreparingPdf(true);
    try {
      const blob = await buildPdfBlob(conversationData?.title || "Paper", effectiveCompiledContent);
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl(URL.createObjectURL(blob));
      setShowPdfPreview(true);
    } catch (e) {
      toast({ title: "Preview failed", variant: "destructive" });
    } finally {
      setIsPreparingPdf(false);
    }
  }, [effectiveCompiledContent, showPdfPreview, pdfPreviewUrl, conversationData, toast]);

  const handleHumanize = useCallback(async () => {
    if (!effectiveCompiledContent) return;
    try {
      const result = await humanizeText.mutateAsync({ text: effectiveCompiledContent });
      setHumanizedCompiledContent(result.humanizedText);
      toast({
        title: "Humanized",
        description: `Rewritten with ${result.provider} (${result.model})`,
      });
    } catch (error) {
      toast({
        title: "Humanize failed",
        description: error instanceof Error ? error.message : "Failed to humanize text",
        variant: "destructive",
      });
    }
  }, [effectiveCompiledContent, humanizeText, toast]);

  const handleRevertHumanized = useCallback(() => {
    setHumanizedCompiledContent(null);
    toast({ title: "Reverted", description: "Showing original compiled paper" });
  }, []);

  const handleQuickGenerate = useCallback(() => {
    if (!hasSelectedProject || !quickTopic.trim() || localSelectedSourceIds.length === 0) {
      toast({ title: "Fill in all fields", variant: "destructive" });
      return;
    }
    const topicWithInstructions = [
      quickTopic.trim(),
      quickAssignmentInstructions.trim()
        ? `\n\nAssignment instructions and grading constraints:\n${quickAssignmentInstructions.trim()}`
        : "",
    ].join("");

    const request: WritingRequest = {
      topic: topicWithInstructions,
      annotationIds: [],
      sourceDocumentIds: localSelectedSourceIds,
      projectId: selectedProjectId,
      writingStyleId: selectedWritingStyleId === NO_STYLE_VALUE ? null : selectedWritingStyleId,
      citationStyle: citationStyle as "mla" | "apa" | "chicago",
      tone: tone as "academic" | "casual" | "ap_style",
      targetLength: quickTargetLength,
      noEnDashes,
      deepWrite: quickDeepWrite,
    };
    quickGenerate.generate(request);
  }, [hasSelectedProject, selectedProjectId, selectedWritingStyleId, quickTopic, quickAssignmentInstructions, localSelectedSourceIds, citationStyle, tone, quickTargetLength, noEnDashes, quickDeepWrite, quickGenerate, toast]);

  // Custom suggested prompts for writing context
  const handleSuggestedPrompt = useCallback((prompt: string) => {
    handleSend(prompt);
  }, [handleSend]);

  const handleSelectDocument = useCallback((document: { title: string; content: string }) => {
    setShowControlsWhenDocument(false);
    setDocuments((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.title === document.title && item.content === document.content
      );
      if (existingIndex >= 0) {
        setSelectedDocIndex(existingIndex);
        return prev;
      }

      const next = [...prev, document];
      setSelectedDocIndex(next.length - 1);
      return next;
    });
    requestAnimationFrame(() => {
      documentPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      documentPanelRef.current?.focus({ preventScroll: true });
    });
  }, [toast]);

  useEffect(() => {
    const content = quickGenerate.fullText.trim();
    if (!content) return;

    const key = `${quickGenerateTitle}\n${content}`;
    if (key === lastQuickGenerateDocumentKeyRef.current) {
      return;
    }

    lastQuickGenerateDocumentKeyRef.current = key;
    handleSelectDocument({ title: quickGenerateTitle, content });
    setQuickGenerateOpen(false);
    toast({
      title: quickGenerateIsPartial ? "Partial draft recovered" : "Paper generated",
      description: quickGenerateIsPartial
        ? "The recovered draft is open in the document panel."
        : "The draft is open in the document panel.",
    });
  }, [
    handleSelectDocument,
    quickGenerate.fullText,
    quickGenerateIsPartial,
    quickGenerateTitle,
    toast,
  ]);

  useEffect(() => {
    if (!quickGenerate.savedPaper) return;
    if (selectedProjectId) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", selectedProjectId, "documents"] });
    }
    toast({
      title: "Saved to Project",
      description: quickGenerate.savedPaper.filename,
    });
  }, [quickGenerate.savedPaper, selectedProjectId, toast]);

  const activeDocument = useMemo(() => {
    if (isDocumentStreaming) {
      return {
        title: documentTitle || "Draft",
        content: streamingDocumentText || "",
        isStreaming: true,
      };
    }

    if (selectedDocIndex === null || !documents[selectedDocIndex]) {
      return null;
    }

    return {
      title: documents[selectedDocIndex].title,
      content: documents[selectedDocIndex].content,
      isStreaming: false,
    };
  }, [documentTitle, documents, isDocumentStreaming, selectedDocIndex, streamingDocumentText]);

  const handleCopyActiveDocument = useCallback(async () => {
    if (!activeDocument?.content) return;
    try {
      await navigator.clipboard.writeText(activeDocument.content);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  }, [activeDocument, toast]);

  const handleDownloadActiveDocumentDocx = useCallback(async () => {
    if (!activeDocument?.content) return;
    setIsPreparingDocx(true);
    try {
      const blob = await buildDocxBlob(activeDocument.title || "Document", activeDocument.content);
      downloadBlob(blob, `${toSafeFilename(activeDocument.title || "Document")}.docx`);
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "DOCX export failed",
        variant: "destructive",
      });
    } finally {
      setIsPreparingDocx(false);
    }
  }, [activeDocument, toast]);

  const handleDownloadGeneratedDocx = useCallback(async (
    title: string,
    content: string,
  ) => {
    if (!content.trim()) return;
    setIsPreparingDocx(true);

    try {
      const blob = await buildDocxBlob(title || "Generated Paper", content);
      downloadBlob(blob, `${toSafeFilename(title || "Generated Paper")}.docx`);
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "DOCX export failed",
        variant: "destructive",
      });
    } finally {
      setIsPreparingDocx(false);
    }
  }, [toast]);

  const handleDownloadSavedGeneratedDraftDocx = useCallback(async (
    draft: (typeof projectSources)[number],
  ) => {
    setIsPreparingDocx(true);

    try {
      const res = await fetch(`/api/documents/${draft.documentId}`, {
        headers: { ...getAuthHeaders() },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Could not load saved paper.");
      const document = await res.json() as { filename?: string; fullText?: string };
      const title = document.filename || draft.document.filename || "Generated Paper";
      const content = document.fullText || "";
      if (!content.trim()) throw new Error("Saved paper has no text to export.");
      const blob = await buildDocxBlob(title, content);
      downloadBlob(blob, `${toSafeFilename(title)}.docx`);
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "DOCX export failed",
        variant: "destructive",
      });
    } finally {
      setIsPreparingDocx(false);
    }
  }, [toast]);

  return (
    <div className="h-full min-h-0 grid grid-cols-1 lg:grid-cols-[250px_1fr_380px] border border-border rounded-xl overflow-auto lg:overflow-hidden bg-[#F5F0E8] dark:bg-background">
      {/* Left Sidebar - Conversations */}
      <ChatSidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
      />

      {/* Center - Chat */}
      <section className="min-h-0 flex flex-col bg-[#FAF7F1] dark:bg-background border-l border-r border-border">
        {/* Project header */}
        <div className="border-b border-border px-5 py-3 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <PenTool className="h-4 w-4 text-primary" />
              {lockProject ? (
                <span className="font-semibold">
                  {hasSelectedProject ? selectedProject?.name || "Project" : "General Writing"}
                </span>
              ) : (
                <Select
                  value={selectedProjectId}
                  onValueChange={(v) => {
                    setSelectedProjectId(v);
                    setActiveConversationId(null);
                    setLocalSelectedSourceIds([]);
                    clearCompiled();
                  }}
                >
                  <SelectTrigger className="w-auto border-0 shadow-none p-0 h-auto font-semibold">
                    <SelectValue placeholder="Select project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROJECT_VALUE}>No Project (General Writing)</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {effectiveCompiledContent && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px] uppercase">{wordCount} words</Badge>
                <Badge variant="outline" className="font-mono text-[10px] uppercase">{pageEstimate} pg</Badge>
                {humanizedCompiledContent && (
                  <Badge variant="secondary" className="font-mono text-[10px] uppercase">Humanized</Badge>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        <ChatMessages
          messages={messages}
          streamingText={streamingText}
          streamingChatText={streamingChatText}
          streamingDocumentTitle={documentTitle}
          streamingDocumentText={streamingDocumentText}
          isDocumentStreaming={isDocumentStreaming}
          isDocumentComplete={isDocumentComplete}
          isStreaming={isStreaming}
          streamStatus={streamStatus}
          pendingUserMessage={pendingUserMessage}
          onDocumentSelect={handleSelectDocument}
          onSuggestedPrompt={handleSuggestedPrompt}
        />

        {/* Input */}
        {contextLoading && (
          <div className="border-t border-border px-5 py-2 text-xs text-muted-foreground bg-background/60">
            {streamStatus?.message || `Loading source context (Level ${contextLoading.level})...`}
          </div>
        )}
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </section>

      {/* Right Panel */}
      <aside
        ref={documentPanelRef}
        tabIndex={-1}
        className="min-h-[320px] lg:min-h-0 bg-[#F1ECE2] dark:bg-muted/10 focus:outline-none"
      >
        <div className="h-full min-h-0 flex flex-col p-4 gap-4">
          {activeDocument && (
            <div className="min-h-0 flex-[1_1_55%]">
              <DocumentPanel
                title={activeDocument.title}
                content={activeDocument.content}
                isStreaming={activeDocument.isStreaming}
                isPreparingDocx={isPreparingDocx}
                onCopy={handleCopyActiveDocument}
                onDownloadDocx={handleDownloadActiveDocumentDocx}
                onClose={() => setSelectedDocIndex(null)}
              />
            </div>
          )}

          {activeDocument && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => setShowControlsWhenDocument((v) => !v)}
            >
              {showControlsWhenDocument ? "Hide Controls" : "Show Controls"}
            </Button>
          )}

          {(!activeDocument || showControlsWhenDocument) && (
            <div className={`${activeDocument ? "min-h-0 flex-[1_1_45%]" : "h-full"} overflow-auto space-y-4`}>
          {/* Settings Card */}
          <Card className="border-border bg-background/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={writingModel} onValueChange={(v) => handleSettingChange("writingModel", v)}>
                <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="precision">Precision (Opus)</SelectItem>
                  <SelectItem value="extended">Extended (Sonnet)</SelectItem>
                </SelectContent>
              </Select>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Select
                  value={selectedWritingStyleId}
                  onValueChange={(v) => handleSettingChange("writingStyleId", v)}
                  disabled={writingStylesLoading}
                >
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue placeholder="Writing style" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_STYLE_VALUE}>No saved style</SelectItem>
                    {writingStyles.map((style) => (
                      <SelectItem key={style.id} value={style.id}>{style.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Link href="/writing-styles">
                  <Button variant="outline" size="icon" className="h-8 w-8" title="Manage writing styles">
                    <PenLine className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
              {writingStylesLoading ? (
                <div className="rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
                  Loading writing styles...
                </div>
              ) : writingStyles.length === 0 ? (
                <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <PenLine className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                    <div className="space-y-1">
                      <div className="text-xs font-medium">No writing style saved yet</div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Add examples of your own writing, then select that style here for chat and full-paper generation.
                      </p>
                    </div>
                  </div>
                  <Link href="/writing-styles">
                    <Button size="sm" className="h-8 w-full text-xs">
                      <PenLine className="h-3.5 w-3.5 mr-2" />
                      Create Writing Style
                    </Button>
                  </Link>
                </div>
              ) : selectedWritingStyle ? (
                <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-xs">
                  <div className="font-medium">Using style: {selectedWritingStyle.name}</div>
                  {selectedWritingStyle.description && (
                    <div className="text-muted-foreground line-clamp-2 mt-1">{selectedWritingStyle.description}</div>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
                  Select a saved writing style to apply your voice to generated writing.
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Select value={tone} onValueChange={(v) => handleSettingChange("tone", v)}>
                  <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="academic">Academic</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                    <SelectItem value="ap_style">AP Style</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={citationStyle} onValueChange={(v) => handleSettingChange("citationStyle", v)}>
                  <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="chicago">Chicago</SelectItem>
                    <SelectItem value="mla">MLA</SelectItem>
                    <SelectItem value="apa">APA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={humanize} onCheckedChange={(v) => handleSettingChange("humanize", Boolean(v))} />
                Humanize prose
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={noEnDashes} onCheckedChange={(v) => handleSettingChange("noEnDashes", Boolean(v))} />
                No en-dashes
              </label>
            </CardContent>
          </Card>

          {/* Sources Card */}
          <Card className="border-border bg-background/80">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {hasSelectedProject ? "Project Sources" : "Web Clips"}
                </CardTitle>
                <button type="button" className="text-xs text-muted-foreground" onClick={() => setSourcesExpanded((v) => !v)}>
                  {sourcesExpanded ? "Hide" : "Show"}
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {sourcesExpanded && (
                <>
                  <div className="flex justify-end mb-2">
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={toggleAllSources} disabled={sourceIds.length === 0}>
                      {sourceIds.length > 0 && sourceIds.every((id) => localSelectedSourceIds.includes(id)) ? "Deselect all" : "Select all"}
                    </Button>
                  </div>
                  <ScrollArea className="h-48">
                    {sourcesLoading ? (
                      <p className="text-xs text-muted-foreground">Loading...</p>
                    ) : hasSelectedProject && projectSources.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No source documents in this project.</p>
                    ) : !hasSelectedProject && standaloneWebClips.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No web clips yet. You can still write in standalone mode without sources.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {hasSelectedProject
                          ? projectSources.map((source) => (
                            <div key={source.id} className="flex items-start gap-2 rounded-md p-2 hover:bg-muted/40">
                              <Checkbox checked={localSelectedSourceIds.includes(source.id)} onCheckedChange={() => toggleSource(source.id)} className="mt-0.5" />
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
                                onClick={() => toggleSource(source.id)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium truncate">{source.document.filename}</span>
                                  <Badge variant="outline" className="text-[10px]">{getDocTypeLabel(source.document.filename)}</Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                                  {source.document.summary || "No summary available."}
                                </p>
                              </button>
                              <SourceRoleSelector
                                sourceId={source.id}
                                currentRole={normalizeSourceRole(source.sourceRole)}
                                onRoleChange={(role) => handleSourceRoleChange(source.id, role)}
                              />
                            </div>
                          ))
                          : standaloneWebClips.map((clip) => (
                            <div key={clip.id} className="flex items-start gap-2 rounded-md p-2 hover:bg-muted/40">
                              <Checkbox checked={localSelectedSourceIds.includes(clip.id)} onCheckedChange={() => toggleSource(clip.id)} className="mt-0.5" />
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
                                onClick={() => toggleSource(clip.id)}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium truncate">{clip.pageTitle}</span>
                                  <Badge variant="outline" className="text-[10px]">WEB</Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                                  {clip.note || clip.highlightedText || clip.sourceUrl}
                                </p>
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </ScrollArea>
                </>
              )}
            </CardContent>
          </Card>

          {/* Actions Card */}
          <Card className="border-border bg-background/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Compile */}
              {!isCompiling ? (
                <Button
                  onClick={handleCompile}
                  className="w-full"
                  disabled={messages.length === 0}
                  title="Formats the drafted chat sections into a clean paper with citations and bibliography."
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Format Your Paper
                </Button>
              ) : (
                <Button variant="destructive" onClick={cancelCompile} className="w-full">
                  <StopCircle className="h-4 w-4 mr-2" />
                  Stop Formatting
                </Button>
              )}
              {isCompiling && (
                <div className="space-y-1 rounded-md border bg-muted/30 p-2">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Formatting paper...</span>
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </div>
                  <Progress value={effectiveCompiledContent ? 75 : 25} className="h-1.5" />
                </div>
              )}

              {/* Verify */}
              <Button variant="outline" onClick={handleVerify} className="w-full" disabled={!effectiveCompiledContent || isVerifying}>
                {isVerifying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                {isVerifying ? "Verifying..." : "Verify Paper"}
              </Button>

              <Button
                variant="outline"
                onClick={handleHumanize}
                className="w-full"
                disabled={!effectiveCompiledContent || humanizeText.isPending}
              >
                {humanizeText.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {humanizedCompiledContent ? "Re-humanize Paper" : "Humanize Compiled Paper"}
              </Button>

              {humanizedCompiledContent && (
                <Button variant="ghost" onClick={handleRevertHumanized} className="w-full">
                  Revert to Original
                </Button>
              )}

              {/* Quick Generate */}
              <Dialog open={quickGenerateOpen} onOpenChange={setQuickGenerateOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full text-xs"
                    disabled={!hasSelectedProject}
                    title={!hasSelectedProject ? "Select a project to use Quick Generate" : undefined}
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Quick Generate (Full Paper)
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Quick Generate Paper</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Topic / Prompt</Label>
                      <Textarea
                        value={quickTopic}
                        onChange={(e) => setQuickTopic(e.target.value)}
                        placeholder="Enter your topic..."
                        className="min-h-[80px]"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Assignment Instructions</Label>
                      <Textarea
                        value={quickAssignmentInstructions}
                        onChange={(e) => setQuickAssignmentInstructions(e.target.value)}
                        placeholder="Paste the full assignment prompt, rubric, citation requirements, professor notes, or structure constraints..."
                        className="min-h-[140px]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={quickTargetLength} onValueChange={(v) => setQuickTargetLength(v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="short">Short (~1500w)</SelectItem>
                          <SelectItem value="medium">Medium (~2500w)</SelectItem>
                          <SelectItem value="long">Long (~4000w)</SelectItem>
                        </SelectContent>
                      </Select>
                      <label className="flex items-center gap-2 text-xs px-2">
                        <Checkbox checked={quickDeepWrite} onCheckedChange={(v) => setQuickDeepWrite(Boolean(v))} />
                        Deep Write
                      </label>
                    </div>
                    <Button onClick={handleQuickGenerate} className="w-full" disabled={quickGenerate.isGenerating}>
                      {quickGenerate.isGenerating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                      {quickGenerate.isGenerating ? "Generating..." : quickGenerate.fullText ? "Generate Again" : "Generate Paper"}
                    </Button>
                    {(quickGenerate.isGenerating || quickGenerate.fullText || quickGenerate.error) && (
                      <div className="space-y-2 rounded-md border bg-muted/30 p-2">
                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>
                            {quickGenerate.error
                              ? quickGenerate.error
                              : quickGenerateIsPartial
                                ? "Partial draft recovered in the document panel."
                              : quickGenerate.fullText
                                ? "Paper ready in the document panel."
                                : quickGenerate.status || "Generating paper..."}
                          </span>
                          {quickGenerate.isGenerating && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
                        </div>
                        {!quickGenerate.error && (
                          <Progress value={quickGenerateProgress} className="h-1.5" />
                        )}
                        {quickGenerate.fullText && !quickGenerate.isGenerating && (
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-xs"
                              onClick={() => setQuickGenerateOpen(false)}
                            >
                              View
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-xs"
                              disabled={isPreparingDocx}
                              onClick={() => handleDownloadGeneratedDocx(
                                quickGenerateTitle,
                                quickGenerate.fullText,
                              )}
                            >
                              DOCX
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          {/* Compiled Paper Card */}
          {(effectiveCompiledContent || isCompiling) && (
            <Card className="border-border bg-background/80">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {isCompiling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    Formatted Paper
                  </CardTitle>
                  {effectiveCompiledContent && (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={handleCopy}><Copy className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="sm" onClick={handleDownloadDocx} disabled={isPreparingDocx}>
                        {isPreparingDocx ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={handleTogglePdfPreview} disabled={isPreparingPdf}>
                        {showPdfPreview ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-64">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                      {effectiveCompiledContent}
                    </ReactMarkdown>
                    {isCompiling && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* PDF Preview */}
          {showPdfPreview && pdfPreviewUrl && (
            <Card className="border-border bg-white">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">PDF Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px] overflow-hidden rounded border">
                  <iframe src={pdfPreviewUrl} title="PDF Preview" className="w-full h-full" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Verify Report */}
          {(verifyReport || isVerifying) && (
            <Card className="border-border bg-background/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4 text-blue-600" />}
                  Verification Report
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                      {verifyReport}
                    </ReactMarkdown>
                    {isVerifying && <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* Quick Generate Result (shown in right panel too) */}
          {quickGenerate.fullText && (
            <Card className="border-border bg-background/80">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Quick Generate Result</CardTitle>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(quickGenerate.fullText);
                        toast({ title: "Copied" });
                      } catch { /* ignore */ }
                    }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isPreparingDocx}
                      onClick={() => handleDownloadGeneratedDocx(quickGenerateTitle, quickGenerate.fullText)}
                    >
                      {isPreparingDocx ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                      {quickGenerate.fullText}
                    </ReactMarkdown>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {generatedProjectDrafts.length > 0 && (
            <Card className="border-border bg-background/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Saved Generated Papers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {generatedProjectDrafts.slice(0, 5).map((draft) => (
                  <div
                    key={draft.id}
                    className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">{draft.document.filename}</div>
                      <div className="text-[11px] text-muted-foreground">Saved in this project</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isPreparingDocx}
                        onClick={() => handleDownloadSavedGeneratedDraftDocx(draft)}
                        title="Download DOCX"
                      >
                        {isPreparingDocx ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
