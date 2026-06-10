import type { Express, Request, Response } from "express";
import { checkTokenBudget, requireAuth } from "../auth";
import { aiLimiter } from "../rateLimits";
import { projectStorage } from "../projectStorage";
import { storage } from "../storage";
import { extractCitationMetadata } from "../openai";
import { createTokenUsageAccumulator } from "../aiUsage";
import {
  generateFootnoteWithQuote,
  generateFootnote,
  generateInTextCitation,
  generateBibliographyEntry,
} from "../citationGenerator";
import {
  citationDataSchema,
  citationStyles,
  type CitationData,
  type CitationStyle,
} from "@shared/schema";
import { verifyDocumentOwnership, verifyProjectDocumentOwnership } from "./documentHandlers";

export function registerCitationRoutes(app: Express): void {
  // === CITATIONS ===

  app.post("/api/citations/generate", requireAuth, async (req: Request, res: Response) => {
    try {
      const { citationData, style = "chicago", pageNumber, isSubsequent } = req.body;
      const validated = citationDataSchema.parse(citationData);
      const validStyle: CitationStyle = (citationStyles as readonly string[]).includes(style)
        ? (style as CitationStyle)
        : "chicago";

      const footnote = generateFootnote(validated, validStyle, pageNumber, isSubsequent);
      const bibliography = generateBibliographyEntry(validated, validStyle);
      const inlineCitation = generateInTextCitation(validated, validStyle, pageNumber);

      res.json({ footnote, bibliography, inlineCitation, style: validStyle });
    } catch (error) {
      console.error("Error generating citation:", error);
      res.status(400).json({ error: "Failed to generate citation" });
    }
  });

  app.post(
    "/api/citations/ai",
    requireAuth,
    aiLimiter,
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const { documentId, highlightedText, style = "chicago" } = req.body;
        const validStyle: CitationStyle = (citationStyles as readonly string[]).includes(style)
          ? (style as CitationStyle)
          : "chicago";

        if (!documentId) {
          return res.status(400).json({ error: "Document ID is required" });
        }

        const document = await verifyDocumentOwnership(req, res, documentId);
        if (!document) return;

        const citationData = await extractCitationMetadata(
          document.fullText,
          highlightedText,
          tokenUsage.add,
        );

        if (!citationData) {
          await tokenUsage.flush(req.user!.userId, "citation_ai");
          return res.status(422).json({
            error: "Unable to extract citation metadata from document",
            footnote: `"${highlightedText?.substring(0, 100) || "Quote"}..." (Source: ${document.filename})`,
            bibliography: `${document.filename}. [Citation metadata unavailable]`,
          });
        }

        const footnote = generateFootnote(citationData, validStyle);
        const bibliography = generateBibliographyEntry(citationData, validStyle);

        await tokenUsage.flush(req.user!.userId, "citation_ai");
        res.json({ footnote, bibliography, citationData });
      } catch (error) {
        console.error("Error generating AI citation:", error);
        res.status(500).json({ error: "Failed to generate citation" });
      }
    },
  );

  // Generate footnote with embedded quote for an annotation
  app.post(
    "/api/citations/footnote-with-quote",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { citationData, quote, pageNumber, style = "chicago" } = req.body;
        const validStyle: CitationStyle = (citationStyles as readonly string[]).includes(style)
          ? (style as CitationStyle)
          : "chicago";

        if (!quote) {
          return res.status(400).json({ error: "Quote text is required" });
        }

        if (!citationData) {
          // Fallback if no citation data: return a generic quote format
          const cleanQuote = quote.trim().replace(/\s+/g, " ");
          const displayQuote =
            cleanQuote.length > 150 ? cleanQuote.substring(0, 147) + "..." : cleanQuote;
          return res.json({
            footnote: `"${displayQuote}."`,
            footnoteWithQuote: `"${displayQuote}."`,
            inlineCitation: "(Source unavailable)",
            bibliography: "[Citation metadata unavailable]",
          });
        }

        const validated = citationDataSchema.parse(citationData);

        const footnote = generateFootnote(validated, validStyle, pageNumber);
        const footnoteWithQuote = generateFootnoteWithQuote(validated, quote, pageNumber);
        const inlineCitation = generateInTextCitation(validated, validStyle, pageNumber);
        const bibliography = generateBibliographyEntry(validated, validStyle);

        res.json({
          footnote,
          footnoteWithQuote,
          inlineCitation,
          bibliography,
        });
      } catch (error) {
        console.error("Error generating footnote with quote:", error);
        res.status(400).json({ error: "Failed to generate footnote" });
      }
    },
  );

  // Generate footnote for a specific annotation by ID
  app.post(
    "/api/project-annotations/:id/footnote",
    requireAuth,
    aiLimiter,
    checkTokenBudget,
    async (req: Request, res: Response) => {
      const tokenUsage = createTokenUsageAccumulator();
      try {
        const annotation = await projectStorage.getProjectAnnotation(req.params.id);
        if (!annotation) {
          return res.status(404).json({ error: "Annotation not found" });
        }

        const projectDoc = await verifyProjectDocumentOwnership(
          req,
          res,
          annotation.projectDocumentId,
        );
        if (!projectDoc) return;

        const { pageNumber, style = "chicago" } = req.body;
        const validStyle: CitationStyle = (citationStyles as readonly string[]).includes(style)
          ? (style as CitationStyle)
          : "chicago";

        // Use citation data from the project document
        const citationData = projectDoc.citationData;

        if (!citationData) {
          // Try to extract citation on-the-fly
          const doc = await storage.getDocument(projectDoc.documentId);
          if (doc) {
            const extractedCitation = await extractCitationMetadata(
              doc.fullText,
              annotation.highlightedText,
              tokenUsage.add,
            );
            if (extractedCitation) {
              // Save for future use
              await projectStorage.updateProjectDocument(projectDoc.id, {
                citationData: extractedCitation,
              });

              const footnoteWithQuote = generateFootnoteWithQuote(
                extractedCitation,
                annotation.highlightedText,
                pageNumber,
              );
              const footnote = generateFootnote(extractedCitation, validStyle, pageNumber);
              const inlineCitation = generateInTextCitation(
                extractedCitation,
                validStyle,
                pageNumber,
              );
              const bibliography = generateBibliographyEntry(extractedCitation, validStyle);

              await tokenUsage.flush(req.user!.userId, "annotation_footnote_citation");
              return res.json({
                footnote,
                footnoteWithQuote,
                inlineCitation,
                bibliography,
                citationData: extractedCitation,
              });
            }
          }

          // Fallback
          const cleanQuote = annotation.highlightedText.trim().replace(/\s+/g, " ");
          const displayQuote =
            cleanQuote.length > 150 ? cleanQuote.substring(0, 147) + "..." : cleanQuote;
          const docName = doc?.filename || "Unknown Source";

          await tokenUsage.flush(req.user!.userId, "annotation_footnote_citation");
          return res.json({
            footnote: `${docName}.`,
            footnoteWithQuote: `${docName}: "${displayQuote}."`,
            inlineCitation: `(${docName})`,
            bibliography: `${docName}. [Citation metadata unavailable]`,
            citationData: null,
          });
        }

        const footnoteWithQuote = generateFootnoteWithQuote(
          citationData as CitationData,
          annotation.highlightedText,
          pageNumber,
        );
        const footnote = generateFootnote(citationData as CitationData, validStyle, pageNumber);
        const inlineCitation = generateInTextCitation(
          citationData as CitationData,
          validStyle,
          pageNumber,
        );
        const bibliography = generateBibliographyEntry(citationData as CitationData, validStyle);

        await tokenUsage.flush(req.user!.userId, "annotation_footnote_citation");
        res.json({
          footnote,
          footnoteWithQuote,
          inlineCitation,
          bibliography,
          citationData,
        });
      } catch (error) {
        console.error("Error generating annotation footnote:", error);
        res.status(500).json({ error: "Failed to generate footnote" });
      }
    },
  );
}
