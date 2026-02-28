import { db } from "./db";
import { eq, and, isNull, desc, asc } from "drizzle-orm";
import {
  projects,
  folders,
  projectDocuments,
  projectAnnotations,
  promptTemplates,
  documents,
  type Project,
  type InsertProject,
  type Folder,
  type InsertFolder,
  type ProjectDocument,
  type InsertProjectDocument,
  type ProjectAnnotation,
  type InsertProjectAnnotation,
  type PromptTemplate,
  type InsertPromptTemplate,
  type CitationData,
  type AnnotationCategory,
} from "@shared/schema";

export interface IProjectStorage {
  // Projects
  createProject(data: InsertProject): Promise<Project>;
  getProject(id: string): Promise<Project | undefined>;
  getAllProjects(userId?: string): Promise<Project[]>;
  updateProject(id: string, data: Partial<InsertProject & { contextSummary?: string; contextEmbedding?: number[] }>): Promise<Project | undefined>;
  deleteProject(id: string): Promise<void>;

  // Folders
  createFolder(data: InsertFolder): Promise<Folder>;
  getFolder(id: string): Promise<Folder | undefined>;
  getFoldersByProject(projectId: string): Promise<Folder[]>;
  updateFolder(id: string, data: Partial<InsertFolder & { contextSummary?: string; contextEmbedding?: number[] }>): Promise<Folder | undefined>;
  deleteFolder(id: string): Promise<void>;
  moveFolder(id: string, newParentId: string | null): Promise<Folder | undefined>;

  // Project Documents
  addDocumentToProject(data: InsertProjectDocument): Promise<ProjectDocument>;
  getProjectDocument(id: string): Promise<ProjectDocument | undefined>;
  getProjectDocumentsByProject(projectId: string): Promise<(ProjectDocument & { document: { id: string; filename: string; summary: string | null } })[]>;
  getProjectDocumentsByFolder(folderId: string): Promise<ProjectDocument[]>;
  updateProjectDocument(id: string, data: Partial<{
    projectContext: string;
    roleInProject: string;
    retrievalContext: string;
    retrievalEmbedding: number[];
    citationData: CitationData;
    folderId: string | null;
    lastViewedAt: Date;
    scrollPosition: number;
  }>): Promise<ProjectDocument | undefined>;
  removeDocumentFromProject(id: string): Promise<void>;

  // Project Annotations
  createProjectAnnotation(data: InsertProjectAnnotation): Promise<ProjectAnnotation>;
  getProjectAnnotation(id: string): Promise<ProjectAnnotation | undefined>;
  getProjectAnnotationsByDocument(projectDocumentId: string): Promise<ProjectAnnotation[]>;
  updateProjectAnnotation(id: string, data: Partial<InsertProjectAnnotation & { searchableContent?: string; searchEmbedding?: number[] }>): Promise<ProjectAnnotation | undefined>;
  deleteProjectAnnotation(id: string): Promise<void>;

  // Prompt Templates
  createPromptTemplate(data: InsertPromptTemplate): Promise<PromptTemplate>;
  getPromptTemplate(id: string): Promise<PromptTemplate | undefined>;
  getPromptTemplatesByProject(projectId: string): Promise<PromptTemplate[]>;
  updatePromptTemplate(id: string, data: Partial<InsertPromptTemplate>): Promise<PromptTemplate | undefined>;
  deletePromptTemplate(id: string): Promise<void>;
}

export const projectStorage: IProjectStorage = {
  // === PROJECTS ===
  async createProject(data: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values(data).returning();
    return project;
  },

  async getProject(id: string): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  },

  async getAllProjects(userId?: string): Promise<Project[]> {
    if (userId) {
      return db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt));
    }
    return db.select().from(projects).orderBy(desc(projects.createdAt));
  },

  async updateProject(id: string, data: Partial<InsertProject & { contextSummary?: string; contextEmbedding?: number[] }>): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return updated;
  },

  async deleteProject(id: string): Promise<void> {
    await db.delete(projects).where(eq(projects.id, id));
  },

  // === FOLDERS ===
  async createFolder(data: InsertFolder): Promise<Folder> {
    const [folder] = await db.insert(folders).values(data).returning();
    return folder;
  },

  async getFolder(id: string): Promise<Folder | undefined> {
    const [folder] = await db.select().from(folders).where(eq(folders.id, id));
    return folder;
  },

  async getFoldersByProject(projectId: string): Promise<Folder[]> {
    return db
      .select()
      .from(folders)
      .where(eq(folders.projectId, projectId))
      .orderBy(asc(folders.sortOrder), asc(folders.name));
  },

  async updateFolder(id: string, data: Partial<InsertFolder & { contextSummary?: string; contextEmbedding?: number[] }>): Promise<Folder | undefined> {
    const [updated] = await db
      .update(folders)
      .set(data)
      .where(eq(folders.id, id))
      .returning();
    return updated;
  },

  async deleteFolder(id: string): Promise<void> {
    await db.delete(folders).where(eq(folders.id, id));
  },

  async moveFolder(id: string, newParentId: string | null): Promise<Folder | undefined> {
    const [updated] = await db
      .update(folders)
      .set({ parentFolderId: newParentId })
      .where(eq(folders.id, id))
      .returning();
    return updated;
  },

  // === PROJECT DOCUMENTS ===
  async addDocumentToProject(data: InsertProjectDocument): Promise<ProjectDocument> {
    const [projectDoc] = await db.insert(projectDocuments).values(data).returning();
    return projectDoc;
  },

  async getProjectDocument(id: string): Promise<ProjectDocument | undefined> {
    const [projectDoc] = await db
      .select()
      .from(projectDocuments)
      .where(eq(projectDocuments.id, id));
    return projectDoc;
  },

  async getProjectDocumentsByProject(projectId: string): Promise<(ProjectDocument & { document: { id: string; filename: string; summary: string | null } })[]> {
    const results = await db
      .select({
        projectDocument: projectDocuments,
        document: {
          id: documents.id,
          filename: documents.filename,
          summary: documents.summary,
        },
      })
      .from(projectDocuments)
      .innerJoin(documents, eq(projectDocuments.documentId, documents.id))
      .where(eq(projectDocuments.projectId, projectId))
      .orderBy(desc(projectDocuments.addedAt));

    return results.map(r => ({
      ...r.projectDocument,
      document: r.document,
    }));
  },

  async getProjectDocumentsByFolder(folderId: string): Promise<ProjectDocument[]> {
    return db
      .select()
      .from(projectDocuments)
      .where(eq(projectDocuments.folderId, folderId));
  },

  async updateProjectDocument(id: string, data: Partial<{
    projectContext: string;
    roleInProject: string;
    retrievalContext: string;
    retrievalEmbedding: number[];
    citationData: CitationData;
    folderId: string | null;
    lastViewedAt: Date;
    scrollPosition: number;
  }>): Promise<ProjectDocument | undefined> {
    const [updated] = await db
      .update(projectDocuments)
      .set(data)
      .where(eq(projectDocuments.id, id))
      .returning();
    return updated;
  },

  async removeDocumentFromProject(id: string): Promise<void> {
    await db.delete(projectDocuments).where(eq(projectDocuments.id, id));
  },

  // === PROJECT ANNOTATIONS ===
  async createProjectAnnotation(data: InsertProjectAnnotation): Promise<ProjectAnnotation> {
    const [annotation] = await db.insert(projectAnnotations).values({
      ...data,
      category: data.category as AnnotationCategory,
    }).returning();
    return annotation;
  },

  async getProjectAnnotation(id: string): Promise<ProjectAnnotation | undefined> {
    const [annotation] = await db
      .select()
      .from(projectAnnotations)
      .where(eq(projectAnnotations.id, id));
    return annotation;
  },

  async getProjectAnnotationsByDocument(projectDocumentId: string): Promise<ProjectAnnotation[]> {
    return db
      .select()
      .from(projectAnnotations)
      .where(eq(projectAnnotations.projectDocumentId, projectDocumentId))
      .orderBy(asc(projectAnnotations.startPosition));
  },

  async updateProjectAnnotation(id: string, data: Partial<InsertProjectAnnotation & { searchableContent?: string; searchEmbedding?: number[] }>): Promise<ProjectAnnotation | undefined> {
    const { category, ...rest } = data;
    const [updated] = await db
      .update(projectAnnotations)
      .set({
        ...rest,
        ...(category && { category: category as AnnotationCategory }),
      })
      .where(eq(projectAnnotations.id, id))
      .returning();
    return updated;
  },

  async deleteProjectAnnotation(id: string): Promise<void> {
    await db.delete(projectAnnotations).where(eq(projectAnnotations.id, id));
  },

  // === PROMPT TEMPLATES ===
  async createPromptTemplate(data: InsertPromptTemplate): Promise<PromptTemplate> {
    const [template] = await db.insert(promptTemplates).values(data).returning();
    return template;
  },

  async getPromptTemplate(id: string): Promise<PromptTemplate | undefined> {
    const [template] = await db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.id, id));
    return template;
  },

  async getPromptTemplatesByProject(projectId: string): Promise<PromptTemplate[]> {
    return db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.projectId, projectId))
      .orderBy(desc(promptTemplates.createdAt));
  },

  async updatePromptTemplate(id: string, data: Partial<InsertPromptTemplate>): Promise<PromptTemplate | undefined> {
    const [updated] = await db
      .update(promptTemplates)
      .set(data)
      .where(eq(promptTemplates.id, id))
      .returning();
    return updated;
  },

  async deletePromptTemplate(id: string): Promise<void> {
    await db.delete(promptTemplates).where(eq(promptTemplates.id, id));
  },
};
