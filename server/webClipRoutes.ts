import type { Express, Request, Response } from "express";
import { requireAuth, requireTier } from "./auth";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  annotationCategories,
  citationDataSchema,
  insertWebClipSchema,
  webClips,
  type AnnotationCategory,
  type CitationData,
  type InsertWebClip,
  type WebClip,
} from "@shared/schema";
import { db } from "./db";
import { generateChicagoBibliography, generateChicagoFootnote } from "./citationGenerator";
import { storage } from "./storage";
import { projectStorage } from "./projectStorage";

const WEB_CLIP_CATEGORY_VALUES = [...annotationCategories, "web_clip"] as const;
const webClipCategorySet = new Set<string>(WEB_CLIP_CATEGORY_VALUES);
const annotationCategorySet = new Set<string>(annotationCategories);

const createWebClipRequestSchema = insertWebClipSchema.extend({
  highlightedText: z.string().trim().min(1),
  sourceUrl: z.string().url(),
  pageTitle: z.string().trim().min(1),
  category: z.string().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
});

const updateWebClipRequestSchema = z.object({
  note: z.string().trim().max(5000).nullable().optional(),
  category: z.string().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  projectId: z.string().nullable().optional(),
  projectDocumentId: z.string().nullable().optional(),
}).strict();

const promoteWebClipRequestSchema = z.object({
  projectId: z.string().optional(),
  projectDocumentId: z.string().optional(),
  category: z.string().optional(),
  note: z.string().trim().max(5000).optional(),
}).strict();

function normalizeWebClipCategory(category?: string | null): string {
  if (category && webClipCategorySet.has(category)) {
    return category;
  }
  return "key_quote";
}

function normalizeAnnotationCategory(category?: string | null): AnnotationCategory {
  if (category && annotationCategorySet.has(category)) {
    return category as AnnotationCategory;
  }
  return "key_quote";
}

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  return url.toString();
}

function normalizeDate(input?: string | null): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const asDate = new Date(trimmed);
  if (!Number.isNaN(asDate.getTime())) {
    return asDate.toISOString().split("T")[0];
  }

  const match = trimmed.match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  return undefined;
}

function parseAuthorName(name?: string | null): Array<{ firstName: string; lastName: string }> {
  if (!name) return [];

  const normalized = name.replace(/^by\s+/i, "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const byAnd = normalized.includes(" and ")
    ? normalized.split(/\s+and\s+/i)
    : normalized.split(/\s*;\s*/);

  return byAnd
    .map((author) => author.trim())
    .filter(Boolean)
    .map((author) => {
      if (author.includes(",")) {
        const [lastNameRaw, ...firstParts] = author.split(",").map((part) => part.trim()).filter(Boolean);
        if (lastNameRaw && firstParts.length > 0) {
          return {
            firstName: firstParts.join(" "),
            lastName: lastNameRaw,
          };
        }
      }

      const parts = author.split(/\s+/).filter(Boolean);
      if (parts.length === 1) {
        return { firstName: "", lastName: parts[0] };
      }

      return {
        firstName: parts.slice(0, -1).join(" "),
        lastName: parts[parts.length - 1],
      };
    })
    .filter((author) => author.lastName.length > 0);
}

function buildCitationData(clip: {
  pageTitle: string;
  sourceUrl: string;
  siteName?: string | null;
  authorName?: string | null;
  publishDate?: string | null;
}): CitationData {
  const normalizedUrl = normalizeUrl(clip.sourceUrl);
  const parsedUrl = new URL(normalizedUrl);

  const citationData: CitationData = {
    sourceType: "website",
    authors: parseAuthorName(clip.authorName),
    title: clip.pageTitle,
    url: normalizedUrl,
    accessDate: new Date().toISOString().split("T")[0],
    containerTitle: clip.siteName || parsedUrl.hostname,
    publicationDate: normalizeDate(clip.publishDate),
  };

  return citationDataSchema.parse(citationData);
}

function buildClipDocumentFilename(pageTitle: string): string {
  const sanitized = (pageTitle || "Web Clip")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  return `${sanitized || "Web Clip"}.txt`;
}

function buildClipDocumentText(clip: WebClip): { fullText: string; startPosition: number; endPosition: number } {
  const parts = [
    `Title: ${clip.pageTitle}`,
    `URL: ${clip.sourceUrl}`,
    clip.authorName ? `Author: ${clip.authorName}` : null,
    clip.publishDate ? `Published: ${clip.publishDate}` : null,
    clip.siteName ? `Site: ${clip.siteName}` : null,
    "",
    "Highlighted Quote:",
    clip.highlightedText,
    clip.surroundingContext ? "" : null,
    clip.surroundingContext ? "Surrounding Context:" : null,
    clip.surroundingContext || null,
  ].filter((value): value is string => Boolean(value));

  const fullText = parts.join("\n").trim();
  const quoteStart = fullText.indexOf(clip.highlightedText);
  const startPosition = quoteStart >= 0 ? quoteStart : 0;
  const endPosition = startPosition + clip.highlightedText.length;

  return { fullText, startPosition, endPosition };
}

function findHighlightRangeInText(fullText: string, highlightedText: string): { startPosition: number; endPosition: number } {
  if (!fullText || !highlightedText) {
    return { startPosition: 0, endPosition: Math.max(1, highlightedText.length) };
  }

  const directIndex = fullText.indexOf(highlightedText);
  if (directIndex >= 0) {
    return {
      startPosition: directIndex,
      endPosition: directIndex + highlightedText.length,
    };
  }

  const foldedText = fullText.toLowerCase();
  const foldedHighlight = highlightedText.toLowerCase();
  const insensitiveIndex = foldedText.indexOf(foldedHighlight);
  if (insensitiveIndex >= 0) {
    return {
      startPosition: insensitiveIndex,
      endPosition: insensitiveIndex + highlightedText.length,
    };
  }

  return { startPosition: 0, endPosition: Math.max(1, highlightedText.length) };
}

async function getWebClipForUser(id: string, userId: string): Promise<WebClip | undefined> {
  const [clip] = await db
    .select()
    .from(webClips)
    .where(and(eq(webClips.id, id), eq(webClips.userId, userId)));
  return clip;
}

async function getOwnedProject(projectId: string, userId: string) {
  const project = await projectStorage.getProject(projectId);
  return project?.userId === userId ? project : undefined;
}

async function getOwnedProjectDocument(projectDocumentId: string, userId: string) {
  const projectDocument = await projectStorage.getProjectDocument(projectDocumentId);
  if (!projectDocument) return undefined;

  const project = await getOwnedProject(projectDocument.projectId, userId);
  if (!project) return undefined;

  return projectDocument;
}

async function validateClipProjectTargets(input: {
  userId: string;
  projectId?: string | null;
  projectDocumentId?: string | null;
}): Promise<{ ok: true; projectId: string | null } | { ok: false; status: number; error: string }> {
  const { userId, projectId, projectDocumentId } = input;
  let resolvedProjectId = projectId || null;

  if (resolvedProjectId) {
    const project = await getOwnedProject(resolvedProjectId, userId);
    if (!project) {
      return { ok: false, status: 404, error: "Project not found" };
    }
  }

  if (projectDocumentId) {
    const projectDocument = await getOwnedProjectDocument(projectDocumentId, userId);
    if (!projectDocument) {
      return { ok: false, status: 404, error: "Project document not found" };
    }

    if (resolvedProjectId && projectDocument.projectId !== resolvedProjectId) {
      return { ok: false, status: 400, error: "Project document does not belong to the selected project" };
    }

    resolvedProjectId = projectDocument.projectId;
  }

  return { ok: true, projectId: resolvedProjectId };
}

export function registerWebClipRoutes(app: Express): void {
  app.post("/api/web-clips", requireAuth, requireTier("pro"), async (req: Request, res: Response) => {
    try {
      const parsed = createWebClipRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid web clip payload", details: parsed.error.flatten() });
      }

      const payload: InsertWebClip = {
        ...parsed.data,
        sourceUrl: normalizeUrl(parsed.data.sourceUrl),
        category: normalizeWebClipCategory(parsed.data.category),
        tags: parsed.data.tags ?? [],
      };

      const targetValidation = await validateClipProjectTargets({
        userId: req.user!.userId,
        projectId: payload.projectId,
        projectDocumentId: payload.projectDocumentId,
      });
      if (!targetValidation.ok) {
        return res.status(targetValidation.status).json({ error: targetValidation.error });
      }

      const citationData = buildCitationData(payload);
      const footnote = generateChicagoFootnote(citationData);
      const bibliography = generateChicagoBibliography(citationData);

      const [created] = await db
        .insert(webClips)
        .values({
          ...payload,
          projectId: targetValidation.projectId,
          userId: req.user!.userId,
          citationData,
          footnote,
          bibliography,
        })
        .returning();

      return res.status(201).json(created);
    } catch (error) {
      console.error("Error creating web clip:", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create web clip" });
    }
  });

  app.get("/api/web-clips", requireAuth, async (req: Request, res: Response) => {
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      const sourceUrlRaw = typeof req.query.sourceUrl === "string" ? req.query.sourceUrl : undefined;
      const category = typeof req.query.category === "string" ? req.query.category : undefined;
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const limit = parsePositiveInt(req.query.limit, 50, 200);
      const offset = parsePositiveInt(req.query.offset, 0, 10_000);
      const sort = typeof req.query.sort === "string" ? req.query.sort : "newest";

      const whereClauses: SQL[] = [];
      whereClauses.push(eq(webClips.userId, req.user!.userId));
      if (projectId) whereClauses.push(eq(webClips.projectId, projectId));
      if (sourceUrlRaw) {
        whereClauses.push(eq(webClips.sourceUrl, normalizeUrl(sourceUrlRaw)));
      }
      if (category) whereClauses.push(eq(webClips.category, category));
      if (search) {
        const escaped = `%${escapeLike(search.toLowerCase())}%`;
        whereClauses.push(sql`(
          lower(${webClips.highlightedText}) LIKE ${escaped} ESCAPE '\\'
          OR lower(coalesce(${webClips.note}, '')) LIKE ${escaped} ESCAPE '\\'
          OR lower(${webClips.pageTitle}) LIKE ${escaped} ESCAPE '\\'
          OR lower(coalesce(${webClips.siteName}, '')) LIKE ${escaped} ESCAPE '\\'
        )`);
      }

      const whereClause = whereClauses.length ? and(...whereClauses) : undefined;
      const orderBy =
        sort === "oldest"
          ? [asc(webClips.createdAt)]
          : sort === "site"
          ? [asc(webClips.siteName), desc(webClips.createdAt)]
          : [desc(webClips.createdAt)];

      const rows = whereClause
        ? await db
            .select()
            .from(webClips)
            .where(whereClause)
            .orderBy(...orderBy)
            .limit(limit)
            .offset(offset)
        : await db
            .select()
            .from(webClips)
            .orderBy(...orderBy)
            .limit(limit)
            .offset(offset);

      return res.json(rows);
    } catch (error) {
      console.error("Error listing web clips:", error);
      return res.status(500).json({ error: "Failed to list web clips" });
    }
  });

  app.get("/api/web-clips/by-url", requireAuth, async (req: Request, res: Response) => {
    try {
      const sourceUrlRaw = typeof req.query.sourceUrl === "string"
        ? req.query.sourceUrl
        : typeof req.query.url === "string"
        ? req.query.url
        : "";

      if (!sourceUrlRaw) {
        return res.status(400).json({ error: "sourceUrl (or url) query parameter is required" });
      }

      const normalizedSourceUrl = normalizeUrl(sourceUrlRaw);
      const rows = await db
        .select()
        .from(webClips)
        .where(and(eq(webClips.userId, req.user!.userId), eq(webClips.sourceUrl, normalizedSourceUrl)))
        .orderBy(desc(webClips.createdAt));

      return res.json(rows);
    } catch (error) {
      console.error("Error filtering web clips by URL:", error);
      return res.status(500).json({ error: "Failed to fetch clips for URL" });
    }
  });

  app.get("/api/web-clips/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const clip = await getWebClipForUser(req.params.id, req.user!.userId);
      if (!clip) {
        return res.status(404).json({ error: "Web clip not found" });
      }

      return res.json(clip);
    } catch (error) {
      console.error("Error fetching web clip:", error);
      return res.status(500).json({ error: "Failed to fetch web clip" });
    }
  });

  app.put("/api/web-clips/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const parsed = updateWebClipRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid update payload", details: parsed.error.flatten() });
      }

      const existing = await getWebClipForUser(req.params.id, req.user!.userId);
      if (!existing) {
        return res.status(404).json({ error: "Web clip not found" });
      }

      const hasProjectId = Object.prototype.hasOwnProperty.call(parsed.data, "projectId");
      const hasProjectDocumentId = Object.prototype.hasOwnProperty.call(parsed.data, "projectDocumentId");
      const targetValidation = await validateClipProjectTargets({
        userId: req.user!.userId,
        projectId: hasProjectId ? parsed.data.projectId : existing.projectId,
        projectDocumentId: hasProjectDocumentId ? parsed.data.projectDocumentId : existing.projectDocumentId,
      });
      if (!targetValidation.ok) {
        return res.status(targetValidation.status).json({ error: targetValidation.error });
      }

      const updates: Partial<WebClip> = {};

      if (Object.prototype.hasOwnProperty.call(parsed.data, "note")) {
        updates.note = parsed.data.note?.trim() || null;
      }

      if (Object.prototype.hasOwnProperty.call(parsed.data, "category")) {
        updates.category = normalizeWebClipCategory(parsed.data.category);
      }

      if (Object.prototype.hasOwnProperty.call(parsed.data, "tags")) {
        updates.tags = parsed.data.tags ?? [];
      }

      if (hasProjectId || (hasProjectDocumentId && parsed.data.projectDocumentId)) {
        updates.projectId = targetValidation.projectId;
      }

      if (hasProjectDocumentId) {
        updates.projectDocumentId = parsed.data.projectDocumentId || null;
      }

      if (Object.keys(updates).length === 0) {
        return res.json(existing);
      }

      const [updated] = await db
        .update(webClips)
        .set(updates)
        .where(and(eq(webClips.id, req.params.id), eq(webClips.userId, req.user!.userId)))
        .returning();

      return res.json(updated);
    } catch (error) {
      console.error("Error updating web clip:", error);
      return res.status(500).json({ error: "Failed to update web clip" });
    }
  });

  app.delete("/api/web-clips/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const clip = await getWebClipForUser(req.params.id, req.user!.userId);
      if (!clip) {
        return res.status(404).json({ error: "Web clip not found" });
      }

      await db.delete(webClips).where(and(eq(webClips.id, req.params.id), eq(webClips.userId, req.user!.userId)));
      return res.json({ success: true });
    } catch (error) {
      console.error("Error deleting web clip:", error);
      return res.status(500).json({ error: "Failed to delete web clip" });
    }
  });

  app.post("/api/web-clips/:id/promote", requireAuth, async (req: Request, res: Response) => {
    try {
      const clip = await getWebClipForUser(req.params.id, req.user!.userId);
      if (!clip) {
        return res.status(404).json({ error: "Web clip not found" });
      }

      const parsed = promoteWebClipRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid promote payload", details: parsed.error.flatten() });
      }

      let resolvedProjectId = parsed.data.projectId || clip.projectId || null;
      const initialProjectDocumentId = parsed.data.projectDocumentId || clip.projectDocumentId || null;
      if (!resolvedProjectId && initialProjectDocumentId) {
        const targetProjectDoc = await getOwnedProjectDocument(initialProjectDocumentId, req.user!.userId);
        if (!targetProjectDoc) {
          return res.status(404).json({ error: "Target project document not found" });
        }
        resolvedProjectId = targetProjectDoc.projectId;
      }
      if (!resolvedProjectId) {
        return res.status(400).json({ error: "projectId is required to promote a web clip" });
      }

      const project = await getOwnedProject(resolvedProjectId, req.user!.userId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      let targetProjectDocumentId = initialProjectDocumentId;
      let targetDocumentText = "";

      if (targetProjectDocumentId) {
        const targetProjectDoc = await getOwnedProjectDocument(targetProjectDocumentId, req.user!.userId);
        if (!targetProjectDoc) {
          return res.status(404).json({ error: "Target project document not found" });
        }

        if (targetProjectDoc.projectId !== resolvedProjectId) {
          return res.status(400).json({ error: "Target project document does not belong to the selected project" });
        }

        const sourceDocument = await storage.getDocument(targetProjectDoc.documentId);
        targetDocumentText = sourceDocument?.fullText || "";
      } else {
        const { fullText, startPosition, endPosition } = buildClipDocumentText(clip);

        const doc = await storage.createDocument({
          filename: buildClipDocumentFilename(clip.pageTitle),
          fullText,
          userId: req.user!.userId,
          summary: null,
          mainArguments: [],
          keyConcepts: [],
        });

        await storage.createChunk({
          documentId: doc.id,
          text: fullText,
          startPosition: 0,
          endPosition: fullText.length,
        });

        await storage.updateDocument(doc.id, { chunkCount: 1 });

        const citationData = clip.citationData || buildCitationData(clip);

        const projectDoc = await projectStorage.addDocumentToProject({
          projectId: resolvedProjectId,
          documentId: doc.id,
          citationData,
        });

        targetProjectDocumentId = projectDoc.id;
        targetDocumentText = fullText;

        // Preserve known quote range when new document is created from the clip.
        const initialRange = { startPosition, endPosition };
        const annotation = await projectStorage.createProjectAnnotation({
          projectDocumentId: targetProjectDocumentId,
          startPosition: initialRange.startPosition,
          endPosition: initialRange.endPosition,
          highlightedText: clip.highlightedText,
          category: normalizeAnnotationCategory(parsed.data.category || clip.category),
          note: parsed.data.note || clip.note || `Web clip from ${clip.sourceUrl}`,
          isAiGenerated: false,
          confidenceScore: null,
        });

        await db
          .update(webClips)
          .set({
            projectId: resolvedProjectId,
            projectDocumentId: targetProjectDocumentId,
            category: normalizeWebClipCategory(parsed.data.category || clip.category),
            note: parsed.data.note ?? clip.note,
          })
          .where(and(eq(webClips.id, clip.id), eq(webClips.userId, req.user!.userId)));

        return res.status(201).json({ annotation, projectDocumentId: targetProjectDocumentId });
      }

      const range = findHighlightRangeInText(targetDocumentText, clip.highlightedText);
      const annotation = await projectStorage.createProjectAnnotation({
        projectDocumentId: targetProjectDocumentId,
        startPosition: range.startPosition,
        endPosition: range.endPosition,
        highlightedText: clip.highlightedText,
        category: normalizeAnnotationCategory(parsed.data.category || clip.category),
        note: parsed.data.note || clip.note || `Web clip from ${clip.sourceUrl}`,
        isAiGenerated: false,
        confidenceScore: null,
      });

      await db
        .update(webClips)
        .set({
          projectId: resolvedProjectId,
          projectDocumentId: targetProjectDocumentId,
          category: normalizeWebClipCategory(parsed.data.category || clip.category),
          note: parsed.data.note ?? clip.note,
        })
        .where(and(eq(webClips.id, clip.id), eq(webClips.userId, req.user!.userId)));

      return res.status(201).json({ annotation, projectDocumentId: targetProjectDocumentId });
    } catch (error) {
      console.error("Error promoting web clip:", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "Failed to promote web clip" });
    }
  });
}
