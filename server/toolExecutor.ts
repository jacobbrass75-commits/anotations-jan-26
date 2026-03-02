import Anthropic from "@anthropic-ai/sdk";
import { globalSearch } from "./projectSearch";
import { loadSurroundingChunks, loadDocumentText } from "./chunkLoader";
import { projectStorage } from "./projectStorage";

export interface ToolExecutionResult {
  content: string;
  isDocument: boolean;
  documentTitle?: string;
}

interface ToolContext {
  projectId: string | null;
  conversationHistory: Array<{ role: string; content: string }>;
  anthropicClient: Anthropic;
}

export async function executeToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  switch (toolName) {
    case "search_sources":
      return executeSearchSources(toolInput, context);
    case "request_annotation_context":
      return executeRequestAnnotationContext(toolInput, context);
    case "deep_source_analysis":
      return executeDeepSourceAnalysis(toolInput, context);
    case "propose_outline":
      return executeProposeOutline(toolInput, context);
    case "write_section":
      return executeWriteSection(toolInput, context);
    case "compile_paper":
      return executeCompilePaper(toolInput, context);
    case "verify_citations":
      return executeVerifyCitations(toolInput, context);
    default:
      return { content: `Unknown tool: ${toolName}`, isDocument: false };
  }
}

async function executeSearchSources(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const query = input.query as string;
  const maxResults = (input.max_results as number) || 10;

  if (!context.projectId) {
    return {
      content: "No project is associated with this conversation. Cannot search sources without a project.",
      isDocument: false,
    };
  }

  const searchResponse = await globalSearch(
    context.projectId,
    query,
    undefined,
    maxResults
  );

  if (searchResponse.results.length === 0) {
    return {
      content: `No results found for "${query}" in the project sources.`,
      isDocument: false,
    };
  }

  const formatted = searchResponse.results.map((r, i) => {
    let entry = `[${i + 1}] `;
    if (r.type === "annotation") {
      entry += `Annotation from "${r.documentFilename}"`;
      if (r.highlightedText) entry += `\n   Quote: "${r.highlightedText}"`;
      if (r.note) entry += `\n   Note: ${r.note}`;
      if (r.category) entry += `\n   Category: ${r.category}`;
    } else if (r.type === "document_context") {
      entry += `Document: "${r.documentFilename}"`;
      entry += `\n   Context: ${r.matchedText}`;
    } else {
      entry += `Folder: "${r.folderName || "Project"}"`;
      entry += `\n   Context: ${r.matchedText}`;
    }
    entry += `\n   Relevance: ${r.relevanceLevel} (${(r.similarityScore * 100).toFixed(0)}%)`;
    if (r.documentId) entry += `\n   Document ID: ${r.documentId}`;
    return entry;
  });

  return {
    content: `Found ${searchResponse.totalResults} results (showing ${searchResponse.results.length}):\n\n${formatted.join("\n\n")}`,
    isDocument: false,
  };
}

async function executeRequestAnnotationContext(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const documentId = input.document_id as string;
  const position = input.position as number;
  const contextChars = (input.context_chars as number) || 500;

  const result = await loadSurroundingChunks(documentId, position, contextChars);

  if (!result) {
    return {
      content: `Could not find document with ID "${documentId}".`,
      isDocument: false,
    };
  }

  return {
    content: `Context around position ${position}:\n\n--- BEFORE ---\n${result.before}\n\n--- TARGET ---\n${result.target}\n\n--- AFTER ---\n${result.after}`,
    isDocument: false,
  };
}

async function executeDeepSourceAnalysis(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const documentId = input.document_id as string;
  const focus = (input.focus as string) || "comprehensive overview";

  const docData = await loadDocumentText(documentId);
  if (!docData) {
    return {
      content: `Could not find document with ID "${documentId}".`,
      isDocument: false,
    };
  }

  // Get project thesis for context
  let thesis = "";
  if (context.projectId) {
    const project = await projectStorage.getProject(context.projectId);
    if (project?.thesis) thesis = project.thesis;
  }

  // Use Anthropic to analyze the document in depth
  const truncatedText = docData.text.slice(0, 15000);

  const response = await context.anthropicClient.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Analyze this academic source in depth. Focus: ${focus}

${thesis ? `Project thesis: ${thesis}\n` : ""}
Document: "${docData.filename}"

Text:
${truncatedText}

Provide a structured analysis including:
1. Main arguments and claims
2. Key evidence and data
3. Methodology (if applicable)
4. Strengths and limitations
5. How this source relates to the thesis/research topic
6. Key quotes worth citing (with approximate positions in text)`,
      },
    ],
  });

  const analysisText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    content: `Deep analysis of "${docData.filename}":\n\n${analysisText}`,
    isDocument: false,
  };
}

async function executeProposeOutline(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const topic = input.topic as string;
  const sections = input.sections as string[] | undefined;
  const style = (input.style as string) || "analytical";

  let thesis = "";
  if (context.projectId) {
    const project = await projectStorage.getProject(context.projectId);
    if (project?.thesis) thesis = project.thesis;
  }

  const sectionsHint = sections
    ? `Include these sections: ${sections.join(", ")}\n`
    : "";

  const response = await context.anthropicClient.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: `Create a detailed academic paper outline.

Topic: ${topic}
${thesis ? `Thesis: ${thesis}\n` : ""}Style: ${style}
${sectionsHint}
Provide:
1. A structured outline with main sections and sub-sections
2. For each section, a brief description of what it should cover
3. Suggested sources to reference (if context is available)
4. Approximate word count per section
5. Key transitions between sections

Format the outline clearly with Roman numerals and lettered sub-points.`,
      },
    ],
  });

  const outlineText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    content: outlineText,
    isDocument: false,
  };
}

async function executeWriteSection(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const title = input.title as string;
  const instructions = input.instructions as string;
  const tone = (input.tone as string) || "formal academic";
  const maxWords = (input.max_words as number) || 500;

  let thesis = "";
  if (context.projectId) {
    const project = await projectStorage.getProject(context.projectId);
    if (project?.thesis) thesis = project.thesis;
  }

  const response = await context.anthropicClient.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Write a section for an academic paper.

Section title: ${title}
${thesis ? `Paper thesis: ${thesis}\n` : ""}
Instructions: ${instructions}
Tone: ${tone}
Target length: approximately ${maxWords} words

Write polished academic prose. Include in-text citations where appropriate using (Author, Year) format. Do not include a bibliography — that will be compiled separately.

Output only the section content, starting with the section heading.`,
      },
    ],
  });

  const sectionText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    content: sectionText,
    isDocument: true,
    documentTitle: title,
  };
}

async function executeCompilePaper(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const sectionOrder = input.section_order as string[] | undefined;
  const includeBibliography = (input.include_bibliography as boolean) !== false;
  const citationStyle = (input.citation_style as string) || "chicago";

  // Gather all written sections from conversation history
  const documentContents: string[] = [];
  for (const msg of context.conversationHistory) {
    // Look for document tags in assistant messages
    if (msg.role === "assistant") {
      const docRegex = /<document[^>]*>([\s\S]*?)<\/document>/g;
      let match;
      while ((match = docRegex.exec(msg.content)) !== null) {
        documentContents.push(match[1].trim());
      }
    }
  }

  if (documentContents.length === 0) {
    return {
      content: "No written sections found in the conversation to compile. Please write sections first using the write_section tool.",
      isDocument: false,
    };
  }

  const sectionsText = documentContents.join("\n\n---\n\n");
  const orderHint = sectionOrder
    ? `Arrange sections in this order: ${sectionOrder.join(", ")}\n`
    : "";

  const response = await context.anthropicClient.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `Compile these written sections into a cohesive academic paper.

${orderHint}Citation style: ${citationStyle}
Include bibliography: ${includeBibliography}

Sections to compile:
${sectionsText}

Tasks:
1. Add smooth transitions between sections
2. Ensure consistent tone and formatting throughout
3. Fix any citation inconsistencies
4. ${includeBibliography ? "Generate a bibliography at the end" : "Do not include a bibliography"}
5. Add a title page with the paper title

Output the complete, compiled paper.`,
      },
    ],
  });

  const paperText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    content: paperText,
    isDocument: true,
    documentTitle: "Compiled Paper",
  };
}

async function executeVerifyCitations(
  input: Record<string, unknown>,
  context: ToolContext
): Promise<ToolExecutionResult> {
  const content = input.content as string | undefined;

  // If no content provided, look for the most recent document in conversation
  let textToVerify = content;
  if (!textToVerify) {
    for (let i = context.conversationHistory.length - 1; i >= 0; i--) {
      const msg = context.conversationHistory[i];
      if (msg.role === "assistant") {
        const docRegex = /<document[^>]*>([\s\S]*?)<\/document>/g;
        const match = docRegex.exec(msg.content);
        if (match) {
          textToVerify = match[1].trim();
          break;
        }
      }
    }
  }

  if (!textToVerify) {
    return {
      content: "No content to verify. Please provide content or write a section first.",
      isDocument: false,
    };
  }

  // Search for source information to cross-reference
  let sourceContext = "";
  if (context.projectId) {
    const searchResult = await globalSearch(context.projectId, "citations references bibliography", undefined, 20);
    if (searchResult.results.length > 0) {
      sourceContext = `\n\nAvailable sources:\n${searchResult.results
        .filter((r) => r.type === "document_context")
        .map((r) => `- ${r.documentFilename}: ${r.matchedText?.slice(0, 200)}`)
        .join("\n")}`;
    }
  }

  const response = await context.anthropicClient.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `Verify the citations in this academic text. Check each citation for:
1. Proper formatting
2. Whether it appears to reference a real source
3. Consistency in citation style
4. Missing citations where claims need support

Text to verify:
${textToVerify}
${sourceContext}

Provide a structured report with:
- List of citations found
- Issues or warnings for each
- Missing citations (claims that need a source)
- Overall citation quality assessment`,
      },
    ],
  });

  const verificationText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    content: verificationText,
    isDocument: false,
  };
}
