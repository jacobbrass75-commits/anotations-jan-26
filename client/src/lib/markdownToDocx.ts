import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
  convertInchesToTwip,
} from "docx";

type MdNode = {
  type: string;
  depth?: number;
  value?: string;
  url?: string;
  ordered?: boolean;
  children?: MdNode[];
  identifier?: string;
  alt?: string;
};

interface MarkdownToDocxOptions {
  title?: string;
}

interface FootnoteRefContext {
  footnoteIdsByIdentifier: Map<string, number>;
  footnoteOrder: string[];
  footnoteDefinitionByIdentifier: Map<string, MdNode>;
}

function parseMarkdown(markdownContent: string): MdNode {
  return unified().use(remarkParse).use(remarkGfm).parse(markdownContent) as unknown as MdNode;
}

function flattenText(node: MdNode | undefined): string {
  if (!node) return "";
  if (node.type === "text" && typeof node.value === "string") {
    return node.value;
  }
  if (!node.children || node.children.length === 0) {
    return "";
  }
  return node.children.map((child) => flattenText(child)).join("");
}

function getHeadingLevel(depth: number): HeadingLevel {
  if (depth <= 1) return HeadingLevel.HEADING_1;
  if (depth === 2) return HeadingLevel.HEADING_2;
  return HeadingLevel.HEADING_3;
}

function ensureFootnoteId(context: FootnoteRefContext, identifier: string): number {
  const existing = context.footnoteIdsByIdentifier.get(identifier);
  if (existing) return existing;
  const id = context.footnoteIdsByIdentifier.size + 1;
  context.footnoteIdsByIdentifier.set(identifier, id);
  context.footnoteOrder.push(identifier);
  return id;
}

function inlineToRuns(node: MdNode, context: FootnoteRefContext, marks: { bold?: boolean; italics?: boolean } = {}): Array<TextRun | ExternalHyperlink | FootnoteReferenceRun> {
  switch (node.type) {
    case "text":
      return [new TextRun({ text: node.value || "", ...marks })];
    case "strong":
      return (node.children || []).flatMap((child) => inlineToRuns(child, context, { ...marks, bold: true }));
    case "emphasis":
      return (node.children || []).flatMap((child) => inlineToRuns(child, context, { ...marks, italics: true }));
    case "inlineCode":
      return [new TextRun({ text: node.value || "", ...marks, font: "Courier New" })];
    case "break":
      return [new TextRun({ break: 1 })];
    case "footnoteReference": {
      const identifier = (node.identifier || "").toLowerCase();
      if (!identifier) return [];
      const id = ensureFootnoteId(context, identifier);
      return [new FootnoteReferenceRun(id)];
    }
    case "link": {
      const children = (node.children || []).flatMap((child) => inlineToRuns(child, context, marks));
      return [new ExternalHyperlink({ link: node.url || "", children: children as TextRun[] })];
    }
    default:
      return (node.children || []).flatMap((child) => inlineToRuns(child, context, marks));
  }
}

function paragraphFromNode(node: MdNode, context: FootnoteRefContext, options: { headingDepth?: number; bullet?: boolean; indentLevel?: number } = {}): Paragraph {
  const children = (node.children || []).flatMap((child) => inlineToRuns(child, context));
  const headingDepth = options.headingDepth;
  const styleByDepth: Record<number, string> = {
    1: "heading1Custom",
    2: "heading2Custom",
    3: "heading3Custom",
  };

  return new Paragraph({
    heading: headingDepth ? getHeadingLevel(headingDepth) : undefined,
    style: headingDepth ? styleByDepth[Math.min(3, Math.max(1, headingDepth))] : undefined,
    children,
    bullet: options.bullet ? { level: options.indentLevel || 0 } : undefined,
    indent: options.indentLevel ? { left: 360 * options.indentLevel } : undefined,
    spacing: {
      line: 480,
      before: headingDepth ? 200 : 0,
      after: headingDepth ? 100 : 120,
    },
  });
}

function blocksFromNode(node: MdNode, context: FootnoteRefContext): Paragraph[] {
  switch (node.type) {
    case "heading":
      return [paragraphFromNode(node, context, { headingDepth: node.depth || 1 })];
    case "paragraph":
      return [paragraphFromNode(node, context)];
    case "blockquote": {
      const content = flattenText(node).trim();
      if (!content) return [];
      return [
        new Paragraph({
          children: [new TextRun(content)],
          indent: { left: convertInchesToTwip(0.4) },
          spacing: { line: 480, after: 120 },
        }),
      ];
    }
    case "list":
      return (node.children || []).flatMap((listItem, index) => {
        const itemContent = listItem.children || [];
        const firstParagraph = itemContent.find((child) => child.type === "paragraph");
        const rest = itemContent.filter((child) => child !== firstParagraph);
        const paragraphs: Paragraph[] = [];
        if (firstParagraph) {
          const runs = (firstParagraph.children || []).flatMap((child) => inlineToRuns(child, context));
          const listRuns = node.ordered
            ? [new TextRun(`${index + 1}. `), ...(runs as TextRun[])]
            : (runs as TextRun[]);
          paragraphs.push(
            new Paragraph({
              children: listRuns,
              bullet: !node.ordered ? { level: 0 } : undefined,
              spacing: { line: 480, after: 120 },
            })
          );
        }
        for (const child of rest) {
          paragraphs.push(...blocksFromNode(child, context));
        }
        return paragraphs;
      });
    case "thematicBreak":
      return [new Paragraph({ children: [new TextRun("")], spacing: { line: 480, after: 240 } })];
    case "code":
      return [
        new Paragraph({
          children: [new TextRun({ text: node.value || "", font: "Courier New" })],
          spacing: { line: 360, after: 180 },
        }),
      ];
    default:
      return (node.children || []).flatMap((child) => blocksFromNode(child, context));
  }
}

function buildFootnotes(context: FootnoteRefContext): Array<{ id: number; children: Paragraph[] }> {
  return context.footnoteOrder.map((identifier) => {
    const id = context.footnoteIdsByIdentifier.get(identifier)!;
    const definition = context.footnoteDefinitionByIdentifier.get(identifier);
    const definitionText = flattenText(definition).trim();
    const children = [
      new Paragraph({
        children: [new TextRun(definitionText || " ")],
        spacing: { line: 360, after: 80 },
      }),
    ];

    return {
      id,
      children: children.length > 0 ? children : [new Paragraph(" ")],
    };
  });
}

export async function markdownToDocx(markdownContent: string, options: MarkdownToDocxOptions = {}): Promise<Blob> {
  const root = parseMarkdown(markdownContent);
  const topLevelChildren = root.children || [];
  const footnoteDefinitionByIdentifier = new Map<string, MdNode>();
  const mainBlocks: MdNode[] = [];

  for (const child of topLevelChildren) {
    if (child.type === "footnoteDefinition" && child.identifier) {
      footnoteDefinitionByIdentifier.set(child.identifier.toLowerCase(), child);
      continue;
    }
    mainBlocks.push(child);
  }

  const context: FootnoteRefContext = {
    footnoteIdsByIdentifier: new Map(),
    footnoteOrder: [],
    footnoteDefinitionByIdentifier,
  };

  const paragraphs = mainBlocks.flatMap((node) => blocksFromNode(node, context));
  const footnotes = buildFootnotes(context);

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Times New Roman",
            size: 24,
          },
          paragraph: {
            spacing: {
              line: 480,
              after: 120,
            },
          },
        },
      },
      paragraphStyles: [
        {
          id: "heading1Custom",
          name: "Heading 1 Custom",
          basedOn: "Normal",
          next: "Normal",
          run: { bold: true, size: 28 },
          paragraph: { spacing: { before: 240, after: 120, line: 480 } },
        },
        {
          id: "heading2Custom",
          name: "Heading 2 Custom",
          basedOn: "Normal",
          next: "Normal",
          run: { bold: true, size: 26 },
          paragraph: { spacing: { before: 220, after: 120, line: 480 } },
        },
        {
          id: "heading3Custom",
          name: "Heading 3 Custom",
          basedOn: "Normal",
          next: "Normal",
          run: { bold: true, size: 24 },
          paragraph: { spacing: { before: 200, after: 100, line: 480 } },
        },
      ],
    },
    footnotes: {
      children: footnotes,
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children: paragraphs.length > 0 ? paragraphs : [new Paragraph(options.title || "Document")],
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ children: [PageNumber.CURRENT] })],
              }),
            ],
          }),
        },
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
