import Anthropic from "@anthropic-ai/sdk";

export const WRITING_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_sources",
    description:
      "Search the loaded project sources for relevant passages by topic or keyword. Use this to find evidence, quotes, and context from the student's uploaded documents before writing.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "The search query — a topic, keyword, or question to find relevant passages for.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default 10).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "request_annotation_context",
    description:
      "Get the surrounding text context for a specific annotation or text position in a document. Use this when you need to see what comes before/after a particular passage.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_id: {
          type: "string",
          description: "The project document ID containing the annotation.",
        },
        position: {
          type: "number",
          description:
            "The character position in the document to get context around.",
        },
        context_chars: {
          type: "number",
          description:
            "Number of characters of context to include on each side (default 500).",
        },
      },
      required: ["document_id", "position"],
    },
  },
  {
    name: "deep_source_analysis",
    description:
      "Run an in-depth analysis on a full source document. Use this when you need comprehensive understanding of a source — its arguments, methodology, key findings, and how it relates to the student's thesis.",
    input_schema: {
      type: "object" as const,
      properties: {
        document_id: {
          type: "string",
          description: "The project document ID to analyze in depth.",
        },
        focus: {
          type: "string",
          description:
            "Optional focus area for the analysis (e.g. 'methodology', 'key arguments', 'relationship to thesis').",
        },
      },
      required: ["document_id"],
    },
  },
  {
    name: "propose_outline",
    description:
      "Create a structured outline for the paper or a section. Use this after gathering enough context from sources to propose an organizational structure for the student's approval.",
    input_schema: {
      type: "object" as const,
      properties: {
        topic: {
          type: "string",
          description: "The topic or thesis for the outline.",
        },
        sections: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of section titles to include. If not provided, the AI will propose sections.",
        },
        style: {
          type: "string",
          enum: ["argumentative", "analytical", "expository", "comparative"],
          description: "The writing style/approach for the paper.",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "write_section",
    description:
      "Write a specific section of the paper. Returns a document card that the student can review, edit, and approve. Always search sources first to ground the writing in evidence.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "The title/heading of the section to write.",
        },
        instructions: {
          type: "string",
          description:
            "Detailed instructions for what this section should cover, including key points, arguments, and sources to reference.",
        },
        tone: {
          type: "string",
          description:
            "The desired academic tone (e.g. 'formal', 'analytical', 'persuasive').",
        },
        max_words: {
          type: "number",
          description: "Approximate maximum word count for the section.",
        },
      },
      required: ["title", "instructions"],
    },
  },
  {
    name: "compile_paper",
    description:
      "Stitch together written sections into a cohesive final paper with transitions, consistent formatting, and a bibliography. Use after all sections have been written and approved.",
    input_schema: {
      type: "object" as const,
      properties: {
        section_order: {
          type: "array",
          items: { type: "string" },
          description:
            "Ordered list of section titles to compile. If not provided, uses the outline order.",
        },
        include_bibliography: {
          type: "boolean",
          description:
            "Whether to include a bibliography at the end (default true).",
        },
        citation_style: {
          type: "string",
          enum: ["chicago", "apa", "mla"],
          description: "Citation style to use (default 'chicago').",
        },
      },
      required: [],
    },
  },
  {
    name: "verify_citations",
    description:
      "Check all citations in the written content against the loaded sources. Flags any citations that cannot be verified, missing citations, or incorrect attributions.",
    input_schema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description:
            "The written content to verify citations in. If not provided, verifies the most recently written section.",
        },
      },
      required: [],
    },
  },
];

export const TOOL_STATUS_LABELS: Record<string, string> = {
  search_sources: "Searching sources...",
  request_annotation_context: "Retrieving context...",
  deep_source_analysis: "Analyzing full source...",
  propose_outline: "Creating outline...",
  write_section: "Writing section...",
  compile_paper: "Compiling paper...",
  verify_citations: "Verifying citations...",
};

export const DOCUMENT_PRODUCING_TOOLS = new Set([
  "write_section",
  "compile_paper",
]);
