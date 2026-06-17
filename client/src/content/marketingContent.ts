export interface ArticleFaq {
  question: string;
  answer: string;
}

export interface BlogArticle {
  slug: string;
  title: string;
  seoTitle: string;
  metaDescription: string;
  excerpt: string;
  category: string;
  targetKeyword: string;
  audience: string;
  readMinutes: number;
  visual: string;
  visualAlt: string;
  ctaText: string;
  ctaUrl: string;
  academicIntegrityNote: string;
  body: string;
  faq: ArticleFaq[];
}

export interface FaqGroup {
  title: string;
  description: string;
  items: ArticleFaq[];
}

const asset = (name: string) => `/campaign-assets/${name}`;

export const blogArticles: BlogArticle[] = [
  {
    slug: "summer-thesis-head-start",
    title: "Summer Thesis Head Start: Start Before Fall Gets Busy",
    seoTitle: "Summer Thesis Head Start: Start Before Fall Gets Busy",
    metaDescription:
      "Plan your thesis, capstone, honors paper, or long research project before fall with a source base, outline, and evidence review workflow.",
    excerpt:
      "A practical eight-week start for students who want a research question, source plan, outline, and first draft feedback before the semester gets crowded.",
    category: "Summer Thesis Head Start",
    targetKeyword: "summer thesis planning",
    audience: "Rising juniors and seniors starting theses, capstones, honors papers, or research seminars.",
    readMinutes: 5,
    visual: asset("summer-thesis-social-square.png"),
    visualAlt: "ScholarMark Summer Thesis Head Start campaign graphic",
    ctaText: "Start your Summer Thesis Head Start",
    ctaUrl: "/summer",
    academicIntegrityNote:
      "ScholarMark supports student-owned research and writing. Before submitting, verify final quotes, citations, paraphrases, and your course or school policy on AI-assisted work.",
    body: `
Summer is a good time to start a serious paper because the first win is not a polished chapter. The first win is a plan you can trust.

If you are heading into a thesis, capstone, honors project, senior seminar, writing sample, or research-heavy class, the semester will get crowded quickly. You do not need to finish the whole project before fall. You need enough structure that the first month is not spent trying to remember what you meant to do.

## What to finish before the semester starts

The best summer start is concrete:

- A focused research question or two strong candidates.
- A source base with useful PDFs, scans, notes, and web clips.
- A quote bank with context, not just isolated highlights.
- A working outline tied to evidence.
- A short list of source gaps to fill next.
- A first section, intro sketch, or argument memo to revise.

That is the difference between "I should start my thesis" and "I know what I am doing next Tuesday."

## An eight-week plan that actually fits student life

Use the summer as a steady ramp:

1. Pick a broad area and collect starting sources.
2. Build a searchable source base.
3. Narrow the research question.
4. Save useful quotes with surrounding context.
5. Group evidence into a working outline.
6. Draft a first section from selected evidence.
7. Review gaps, counterarguments, and citation notes.
8. Verify quotes and make a fall plan.

The goal is momentum. A clean source base and working outline can make fall feel less like a rescue mission.

## Where ScholarMark fits

ScholarMark is built for the part of academic writing that happens before the final paragraph looks polished. You can collect sources, search across them, save useful passages, keep quote context attached, build citation notes, and draft from selected evidence.

Use it as a writing coach and research workspace. It can help you plan and revise, but the final argument and judgment stay yours.

## The first move

Start with whatever you have: a prompt, a vague topic, a syllabus note, a few PDFs, or a half-formed idea. Turn that into a source base and a question. The paper becomes less intimidating once the evidence has a place to live.
`,
    faq: [
      {
        question: "Who should join Summer Thesis Head Start?",
        answer:
          "Rising juniors and seniors with major research-heavy writing ahead are the main audience. It also fits students preparing for research methods, upper-level seminars, honors work, grad school writing, law school writing samples, or capstone projects.",
      },
      {
        question: "Do I need a topic already?",
        answer:
          "No. A good summer start can begin with narrowing a broad interest, collecting starting sources, and turning early reading into a working research question.",
      },
      {
        question: "What should I do in week one?",
        answer:
          "Choose a broad area, collect 8 to 12 starting sources, skim for repeated debates or questions, and save useful passages with notes about why they might matter.",
      },
      {
        question: "Can I use this for a capstone or honors paper?",
        answer:
          "Yes. The same workflow works for capstones, honors theses, senior seminars, research papers, literature reviews, and long writing samples.",
      },
    ],
  },
  {
    slug: "ai-writing-with-real-sources",
    title: "AI Writing With Real Sources: Quote, Context, Evidence",
    seoTitle: "AI Writing With Real Sources: Quote, Context, Evidence",
    metaDescription:
      "Use AI writing support without losing your sources. Build quote context, citation notes, and source-grounded drafts in ScholarMark.",
    excerpt:
      "AI writing gets risky when the draft sounds finished before the evidence is settled. Start from sources, not a blank chat.",
    category: "Source-Grounded Writing",
    targetKeyword: "AI writing with sources",
    audience: "Thesis, capstone, honors, senior seminar, and long research-paper students.",
    readMinutes: 6,
    visual: asset("summer-thesis-source-grounded-ai.png"),
    visualAlt: "Source-grounded AI writing graphic for ScholarMark",
    ctaText: "Try source-grounded writing support",
    ctaUrl: "/summer",
    academicIntegrityNote:
      "ScholarMark supports student-owned research and writing. Before submitting, verify final quotes, citations, paraphrases, and your course or school policy on AI-assisted work.",
    body: `
AI writing gets risky when the draft sounds finished before the evidence is settled.

A paragraph can sound polished. A citation can look formatted. A quote can feel exactly right for the claim. But if you cannot find the passage, inspect the context, and explain why the source supports your point, the writing is not ready.

AI writing with real sources means the workflow starts with evidence.

## What "with sources" should mean

For academic work, "with sources" should mean more than a bibliography at the bottom of a generated answer.

It should mean:

- You know which source a claim came from.
- You can open the passage behind a quote.
- You can see surrounding context before and after the quoted text.
- You can keep citation notes attached to evidence.
- You can separate verified sources from AI-suggested leads.
- You can check final quotes, citations, and paraphrases before submission.

That is the difference between writing from evidence and trying to reverse-engineer sources after a draft already exists.

## Source base first, writing second

Start by collecting the materials you are actually allowed to use. Then organize them into a searchable project.

In ScholarMark, that source base can include uploaded documents, pasted text, annotations, web clips, and project notes. Once the evidence is there, you can search for useful passages, save quotes with context, and draft from selected material instead of asking AI to invent a bibliography from scratch.

The workflow looks like this:

1. Collect your sources.
2. Search across the project.
3. Save useful passages.
4. Keep citation notes attached.
5. Build an outline from evidence.
6. Draft with source context visible.
7. Verify quotes, citations, and claims before export.

This does not remove your responsibility as the writer. It makes that responsibility easier to carry.

## Quote context is the difference

A citation tells the reader where a source came from. Quote context tells you whether you are using it honestly.

A real quote can still be misread. A sentence may look strong in isolation but mean something narrower in the paragraph around it. A source may discuss a counterargument rather than the author's own position. A statistic may apply to a different population, year, or method than your claim suggests.

When you keep context attached, you can ask better questions: What was the author responding to? What does the next paragraph change? Does this quote support my sentence exactly, or only loosely?

## Where ScholarMark fits

ScholarMark helps students move from source collection to evidence-backed writing. Build a searchable project source base, find passages across uploaded documents and clips, keep annotations attached, draft from selected evidence, and review unsupported claims before export.

Use it as a research writing workspace, not as a paper-writing shortcut.
`,
    faq: [
      {
        question: "What is AI writing with sources?",
        answer:
          "AI writing with sources means using AI support while keeping claims connected to actual source material, including quote context, citation notes, and a final verification step.",
      },
      {
        question: "Can AI writing tools invent citations?",
        answer:
          "Yes. AI tools can produce citations that look real but do not match actual sources, or cite real sources that do not support the claim. Treat AI-suggested citations as leads until verified.",
      },
      {
        question: "Does ScholarMark write my paper for me?",
        answer:
          "No. ScholarMark supports planning, source organization, quote context, citation notes, outlining, drafting, and verification for student-owned work.",
      },
      {
        question: "What should I verify before submitting?",
        answer:
          "Verify direct quotes, citation metadata, source support, paraphrase accuracy, bibliography format, and your instructor or school policy on AI-assisted work.",
      },
    ],
  },
  {
    slug: "avoid-hallucinated-quotes",
    title: "How To Avoid Getting Burned By Hallucinated Quotes",
    seoTitle: "How To Avoid Getting Burned By Hallucinated Quotes",
    metaDescription:
      "AI can invent quotes and citations. Learn a safer workflow for finding passages, keeping context, and verifying sources before submission.",
    excerpt:
      "The scariest AI writing problem is not a weird sentence. It is the perfect quote that turns out not to exist.",
    category: "Citation Safety",
    targetKeyword: "hallucinated quotes AI",
    audience: "Students using AI for research papers, theses, capstones, and literature reviews.",
    readMinutes: 6,
    visual: asset("summer-thesis-quote-context.png"),
    visualAlt: "Find the quote and keep the context graphic",
    ctaText: "Find the quote. Keep the context. Write from evidence.",
    ctaUrl: "/summer",
    academicIntegrityNote:
      "Do not submit quotes, citations, or source claims you have not checked. ScholarMark supports student-owned work, but final verification and policy fit are your responsibility.",
    body: `
The scariest AI writing problem is not a weird sentence. You can fix a weird sentence.

The bigger problem is the perfect quote that turns out not to exist.

Maybe the author is real. Maybe the article is real. Maybe the idea sounds close to something you read. But when you search the PDF, check the page, or look up the source, the quote falls apart.

That is a hallucinated quote.

## What is a hallucinated quote?

A hallucinated quote is text that an AI tool presents as a real quotation even though the exact wording cannot be found in the source. Sometimes it is attached to a real author. Sometimes it is attached to a real article. Sometimes the source itself is invented.

The lesson is simple: never let a quote into your final draft unless you can find it in the source.

## Why prompts are not enough

It is tempting to solve the problem by writing a stricter prompt: only use real quotes, do not make anything up, give exact citations.

Those instructions help, but they are not a verification system. A model can still produce confident text that is wrong. For serious academic writing, you need a workflow, not just a better prompt.

## The safer workflow

Use this order:

1. Build the source base.
2. Find the passage.
3. Save the quote with surrounding context.
4. Attach citation notes.
5. Draft from saved evidence.
6. Verify before export.

This flips the usual AI mistake. Instead of asking AI to create a draft and then chasing sources afterward, you start with sources you can inspect.

## Build a quote bank

For every quote you might use, save the exact quoted text, source title, author, page or location, surrounding context, why the quote matters, the claim it may support, and verification status.

This makes your draft easier to build and easier to defend.

## Verify before export

Before submitting, check every direct quote. Does the exact wording appear in the source? Is the author, title, year, and page correct? Does the surrounding context support your use? Is the quote introduced and explained in your own words?

If any answer is no, pause. Replace the quote, revise the claim, or remove the passage.

ScholarMark is built for this evidence-first workflow. It helps you collect sources, search across your project, save useful passages, keep context attached, create citation notes, draft from selected evidence, and review quotes and claims before export.
`,
    faq: [
      {
        question: "What is a hallucinated quote?",
        answer:
          "A hallucinated quote is a quote-like sentence that an AI tool presents as real even though the exact wording cannot be found in the original source.",
      },
      {
        question: "Can AI invent quotes from real sources?",
        answer:
          "Yes. AI can generate plausible wording and attach it to a real source or author. Always search the source for the exact wording before using a direct quote.",
      },
      {
        question: "How do I check whether an AI quote is real?",
        answer:
          "Open the original source and search for the exact phrase. If it is a PDF or scan, check the relevant page or section manually as well because OCR and search can miss text.",
      },
      {
        question: "What should I do if I cannot verify a quote?",
        answer:
          "Do not use it as a direct quote. Replace it with a verified passage, paraphrase only after checking the source, or remove the claim.",
      },
    ],
  },
  {
    slug: "source-grounded-ai-writing",
    title: "What Source-Grounded AI Writing Means For Students",
    seoTitle: "What Source-Grounded AI Writing Means For Students",
    metaDescription:
      "Source-grounded AI writing starts from your actual materials, not a blank chat. Learn how it supports safer academic drafting.",
    excerpt:
      "Do not ask AI to write from nowhere. Ask it to work from sources you can inspect.",
    category: "Source-Grounded Writing",
    targetKeyword: "source grounded AI writing",
    audience: "Students, advisors, writing centers, and faculty looking for responsible AI writing support.",
    readMinutes: 5,
    visual: asset("summer-thesis-source-grounded-ai.png"),
    visualAlt: "Source-grounded AI workflow visual",
    ctaText: "Start with your sources, not a blank chat.",
    ctaUrl: "/summer",
    academicIntegrityNote:
      "Source-grounded writing can support responsible academic work, but you still need to verify final quotes, citations, paraphrases, and your course policy before submitting.",
    body: `
Source-grounded AI writing is a simple idea with serious academic consequences:

Do not ask AI to write from nowhere. Ask it to work from sources you can inspect.

Research papers, theses, capstones, and honors projects are not judged only by how smooth the sentences sound. They are judged by whether the argument is supported, whether the sources are real, and whether the evidence says what the writer claims it says.

## Source-grounded writing in plain English

Source-grounded writing means your draft is built around a known source base.

That source base might include PDFs, book chapters, scanned documents, pasted notes, web clips, interview transcripts, article highlights, citation notes, and annotations.

Instead of asking a chatbot to invent a draft and then hoping the citations work, you start with material you have chosen. The AI can help search, summarize, outline, revise, and draft from that material, but the evidence remains visible.

## Is this the same as RAG?

RAG stands for retrieval-augmented generation. In plain language, the system retrieves relevant information before generating an answer or draft.

For students, the technical name matters less than the practical behavior:

- Does the tool work from my uploaded or selected sources?
- Can I see what passage it used?
- Can I check the quote in context?
- Can I tell which claims still need evidence?

If the answer is no, the tool may still be useful for brainstorming, but it is weaker for academic writing.

## What source grounding helps with

Source-grounded writing can help students avoid chasing fake citations after drafting, keep quote context attached, build outlines from evidence, identify weak claims, compare sources inside a project, draft sections from selected material, and review citations before export.

It is especially useful for long projects where the source base is too large to keep in your head.

## What source grounding does not guarantee

Source-grounded does not mean perfect. It does not guarantee every citation is correct, every quote is interpreted correctly, every paraphrase is faithful, every source fits the assignment, or every school policy allows the same AI use.

That is why ScholarMark should be used as verification support, not as a magic guarantee.
`,
    faq: [
      {
        question: "What does source-grounded AI writing mean?",
        answer:
          "It means the AI works from selected source material instead of relying only on a general model response. For students, that usually means uploaded readings, notes, annotations, and citation-connected evidence.",
      },
      {
        question: "Is source-grounded AI the same as RAG?",
        answer:
          "RAG is one technical approach that retrieves relevant source content before generating a response. Source-grounded writing is the practical academic workflow built around that idea.",
      },
      {
        question: "Does source-grounded AI eliminate hallucinations?",
        answer:
          "No. It can reduce risk by grounding output in source material, but final verification is still necessary.",
      },
      {
        question: "How is ScholarMark different from a blank chatbot?",
        answer:
          "A blank chatbot starts from a prompt. ScholarMark starts from a project source base, annotations, quote context, citation notes, and selected evidence.",
      },
    ],
  },
  {
    slug: "citation-verification-ai",
    title: "Citation Verification AI: A Safer Research Workflow",
    seoTitle: "Citation Verification AI: A Safer Research Workflow",
    metaDescription:
      "Learn how to verify AI citations, quotes, and source claims before submitting a research paper, thesis, or capstone.",
    excerpt:
      "Citation formatting makes a reference look right. Citation verification checks whether the source actually supports your claim.",
    category: "Citation Safety",
    targetKeyword: "citation verification AI",
    audience: "Students writing research papers, theses, capstones, literature reviews, and writing samples.",
    readMinutes: 5,
    visual: asset("summer-thesis-citation-aware-story.png"),
    visualAlt: "Citation-aware story visual",
    ctaText: "Build a draft you can check before you submit.",
    ctaUrl: "/summer",
    academicIntegrityNote:
      "ScholarMark can help you organize and review citation evidence, but you should still verify final citations, quotes, and school policy fit before submitting academic work.",
    body: `
Citation verification is not the same as citation formatting.

Formatting asks whether a citation looks like MLA, APA, Chicago, or another required style.

Verification asks harder questions: Does the source exist? Is this the right author, title, date, and publication? Does the source actually support the claim? Does the direct quote match the original wording? Does the surrounding context change the meaning?

For academic writing, those questions matter more than whether the punctuation is perfect.

## Why AI citations need checking

AI tools can generate citations that look convincing. They can also mix real and false details: a real journal with a fake article title, a real author with a nonexistent paper, or a real article that does not support the claim.

Responsible AI use requires a checking workflow.

## The five-part citation check

### 1. Source existence

Can you find the source in a library database, Google Scholar, Crossref, the publisher site, or another reliable index? If not, do not cite it.

### 2. Metadata accuracy

Check author, title, publication name, year, DOI or URL, page range, edition, and version. Small errors can become big problems when a professor or reader tries to find your source.

### 3. Claim support

Open the source and ask whether it supports the exact sentence you are writing. Not the general topic. Not a nearby idea. The exact claim.

### 4. Quote fidelity

If you use quotation marks, the wording must match. Check spelling, omissions, punctuation, page number, and surrounding context.

### 5. Policy fit

Make sure the source and AI workflow fit the assignment. Some instructors restrict source types. Some require AI disclosure. Some prohibit generative AI for certain tasks.

## How ScholarMark helps

ScholarMark helps students keep the checking process connected to their writing. Store sources in a project, search across source text and annotations, save passages before drafting, keep citation notes attached to evidence, draft from selected sources, and review quotes and claims before export.

The goal is not to remove human judgment. The goal is to make verification easier and harder to skip.
`,
    faq: [
      {
        question: "What is citation verification?",
        answer:
          "Citation verification is the process of checking that a source exists, the citation details are accurate, and the source actually supports the claim or quote in your draft.",
      },
      {
        question: "Can an AI citation generator be wrong?",
        answer:
          "Yes. Citation generators and AI writing tools can produce incorrect metadata, irrelevant sources, or fabricated citations. Always check important citations against the original source.",
      },
      {
        question: "What is the difference between citation formatting and verification?",
        answer:
          "Formatting makes a citation look correct in a style. Verification confirms the source is real and supports the point being made.",
      },
      {
        question: "Does ScholarMark guarantee my citations are correct?",
        answer:
          "No. ScholarMark helps you organize evidence and review citations, but final verification remains the student's responsibility.",
      },
    ],
  },
  {
    slug: "how-to-organize-sources-for-research-paper",
    title: "How To Organize Sources For A Long Research Paper",
    seoTitle: "How To Organize Sources For A Long Research Paper",
    metaDescription:
      "Build a source base, quote bank, citation notes, and outline before drafting your thesis, capstone, or long research paper.",
    excerpt:
      "Every long paper has the same bad moment: you remember reading something important, but you cannot find it.",
    category: "Research Workflow",
    targetKeyword: "organize sources research paper",
    audience: "Thesis, capstone, honors, seminar, literature review, and research-paper students.",
    readMinutes: 6,
    visual: asset("summer-thesis-large-source-base.png"),
    visualAlt: "Large source base to usable evidence graphic",
    ctaText: "Build your source base in ScholarMark.",
    ctaUrl: "/summer",
    academicIntegrityNote:
      "Good source organization does not replace final verification. Before submitting, check your quotes, citations, paraphrases, and assignment policy.",
    body: `
Every long research paper has the same bad moment.

You remember reading something important. You know it would help your argument. You can almost picture the page. But you cannot remember whether it came from a PDF, a book chapter, a web article, a note, or a source you already rejected.

That is not a writing problem yet. It is a source organization problem. Fix that first.

## Step 1: Build one source base

Before drafting, collect your materials in one project: PDFs, scans, book chapters, web sources, lecture notes, pasted excerpts, database links, interview notes, and citation manager exports.

The goal is not to make the system beautiful. The goal is to make the source base searchable and usable.

## Step 2: Use simple source statuses

Do not overcomplicate your system. Start with five labels:

- To read
- Skimmed
- Useful
- Cited
- Rejected

This helps you avoid rereading the same source three times or citing a source you only skimmed.

## Step 3: Save quotes with context

A highlight alone is not enough. For each useful passage, save the exact quote, page or location, surrounding paragraph, short note on why it matters, possible claim it supports, and citation note.

This becomes your quote bank.

## Step 4: Group evidence before outlining

Once you have a quote bank, group passages by theme: background context, major debate, key definition, supporting evidence, counterargument, method, framework, or limitation.

Then turn those groups into outline sections.

## Step 5: Draft from the outline, not the pile

Do not draft directly from a messy folder of PDFs. Draft from an outline that already has evidence attached.

For each section, ask what claim you are making, which source supports it, whether you need a direct quote or paraphrase, what context the reader needs, and whether there is a counterpoint to address.

That gives your paper structure before the sentences get polished.

ScholarMark gives students a workspace for the source-heavy part of writing: collecting sources, searching across them, saving evidence, keeping context attached, drafting from selected passages, and reviewing quotes and citations before export.
`,
    faq: [
      {
        question: "How do I organize sources for a research paper?",
        answer:
          "Start with one source base, use simple source statuses, save quotes with context, group evidence by theme, and build the outline from those evidence groups.",
      },
      {
        question: "Should I use Zotero, Notion, Obsidian, or ScholarMark?",
        answer:
          "Each tool has a different strength. Zotero is strong for reference management. Notion and Obsidian are flexible note systems. ScholarMark is built for source-grounded writing, quote context, and evidence review.",
      },
      {
        question: "What belongs in a quote bank?",
        answer:
          "A quote bank should include exact passage text, source title, author, page or location, surrounding context, and a note about how the quote might support your argument.",
      },
      {
        question: "How do I know when I have enough sources?",
        answer:
          "You probably have enough starting sources when your outline has evidence for each major section and you can explain what gap each remaining source search is meant to fill.",
      },
    ],
  },
  {
    slug: "best-ai-writing-tool-for-students",
    title: "Best AI Writing Tool For Serious Students: What To Look For",
    seoTitle: "Best AI Writing Tool For Serious Students",
    metaDescription:
      "Compare AI writing tools by source grounding, quote context, citation support, revision help, privacy, and academic integrity.",
    excerpt:
      "The best AI writing tool depends on the writing problem. Serious research writing needs source grounding and verification.",
    category: "Tool Comparison",
    targetKeyword: "best AI writing tool for students",
    audience: "Students comparing AI writing apps for long academic projects and writing samples.",
    readMinutes: 5,
    visual: asset("summer-thesis-verification-workflow.png"),
    visualAlt: "Verification workflow graphic",
    ctaText: "Choose the workflow that keeps your evidence visible.",
    ctaUrl: "/summer",
    academicIntegrityNote:
      "The best AI tool is still only support. Always follow your assignment rules and verify final quotes, citations, and source use before submitting.",
    body: `
The best AI writing tool for students depends on what kind of writing problem you are trying to solve.

If you only need grammar help, a proofreading tool may be enough. If you need a quick summary of a paper, a research assistant may help. If you need to organize dozens of sources, find quotes, keep context, build an outline, and verify citations before submitting, you need something more specific.

You need a source-grounded writing workflow.

## What serious students should compare

Before choosing an AI writing app, ask these questions.

## 1. Can it work from your actual sources?

For academic writing, your sources matter. A tool that generates smooth paragraphs without seeing your source base can still produce unsupported claims.

Look for support for uploaded documents, pasted text, web clips, annotations, or selected evidence.

## 2. Can you inspect quote context?

A direct quote is only useful if you can find it and understand the paragraph around it.

The tool should help you move from quote to source, not just drop a citation after a sentence.

## 3. Does it distinguish citations from verification?

Many tools can format a citation. Fewer tools help you check whether the source exists, whether the quote is exact, and whether the source supports the claim.

That distinction matters.

## 4. Does it support student-owned work?

Avoid tools that frame the job as generate and submit. A serious academic writing tool should help you think, plan, revise, verify, and explain your process.

## 5. Can it help across a long project?

A senior thesis, capstone, or literature review may last weeks or months. You need more than a one-off answer. You need project memory: sources, notes, annotations, quote banks, outlines, drafts, and verification.

## The safest test

Before you trust any AI writing tool, ask: Can I explain where this sentence came from?

If the answer is no, do not submit it yet.

ScholarMark's lane is source-grounded academic writing for students who need source organization, quote context, citation notes, drafting, and verification in one workflow.
`,
    faq: [
      {
        question: "What is the best AI writing tool for students?",
        answer:
          "For serious academic work, the best tool is one that supports your process without replacing your thinking. Look for source grounding, quote context, citation notes, revision support, and verification.",
      },
      {
        question: "Is Grammarly enough for research papers?",
        answer:
          "Grammarly can help with grammar, clarity, citations, and polish. For long research projects, students may also need deeper source organization, quote context, and evidence-based drafting.",
      },
      {
        question: "Is NotebookLM enough for thesis writing?",
        answer:
          "NotebookLM can be useful for asking questions about uploaded sources. Thesis writing may also require citation notes, quote banks, outlines, draft review, and final verification workflow.",
      },
      {
        question: "What should serious students avoid in AI writing tools?",
        answer:
          "Avoid tools that encourage submitting generated text without checking sources. Also avoid any tool that promises detector evasion, guaranteed grades, or perfect citations.",
      },
    ],
  },
];

export const faqGroups: FaqGroup[] = [
  {
    title: "ScholarMark Basics",
    description: "What ScholarMark is, who it helps, and how it fits student-owned work.",
    items: [
      {
        question: "What is ScholarMark?",
        answer:
          "ScholarMark is a source-grounded research writing workspace for students. It helps you collect sources, find useful passages, keep quote context attached, organize citation notes, build outlines, and review drafts against your evidence.",
      },
      {
        question: "Who is ScholarMark for?",
        answer:
          "ScholarMark is for students working on research-heavy writing: theses, capstones, honors papers, senior seminars, literature reviews, long class papers, and writing samples.",
      },
      {
        question: "Does ScholarMark write my paper for me?",
        answer:
          "No. ScholarMark is designed to support student-owned work. It helps you organize evidence, plan sections, draft from selected sources, and verify quotes and citations, but the argument, judgment, and final submission remain yours.",
      },
      {
        question: "Can I use ScholarMark for a capstone?",
        answer:
          "Yes. Capstone projects often involve sources, notes, background research, evidence, and a final written deliverable. ScholarMark can help you build a source base, organize quote context, create an outline, and review the draft before submission.",
      },
      {
        question: "Can I use ScholarMark for an honors thesis?",
        answer:
          "Yes. ScholarMark is a good fit for honors thesis planning because it supports the early stages students often delay: source collection, research-question development, quote organization, outline building, and evidence review.",
      },
      {
        question: "What should I verify before submitting?",
        answer:
          "Verify the final quote text, source location, citation metadata, bibliography format, paraphrase accuracy, and your instructor or school policy on AI-assisted work.",
      },
    ],
  },
  {
    title: "AI Quotes And Citations",
    description: "How to think about hallucinated quotes, fake citations, and verification.",
    items: [
      {
        question: "What is a hallucinated quote?",
        answer:
          "A hallucinated quote is a quotation that an AI tool presents as real even though the exact wording cannot be found in the source. Sometimes the source exists but the quote does not. Sometimes both the quote and source are invented.",
      },
      {
        question: "What is a hallucinated citation?",
        answer:
          "A hallucinated citation is a reference that looks scholarly but does not match a real source, or points to a real source that does not support the claim.",
      },
      {
        question: "Can AI invent quotes from real sources?",
        answer:
          "Yes. AI can produce a quote-like sentence that sounds plausible for a real author or article without matching the original text. That is why exact quote verification matters.",
      },
      {
        question: "Can AI citations be trusted?",
        answer:
          "AI-generated citations should be treated as leads until verified. Some may be correct, some may contain metadata errors, and some may be entirely fabricated.",
      },
      {
        question: "What should I do if a quote cannot be verified?",
        answer:
          "Do not use it as a direct quote. Replace it with a verified passage, paraphrase only after checking the original source, or remove the claim if you cannot support it.",
      },
    ],
  },
  {
    title: "Source-Grounded AI Writing",
    description: "Why ScholarMark starts from source material instead of a blank chat.",
    items: [
      {
        question: "What is source-grounded AI writing?",
        answer:
          "Source-grounded AI writing means the AI works from your selected sources instead of relying only on a general model response. In ScholarMark, the workflow starts with a source base, annotations, quote context, and citation notes.",
      },
      {
        question: "Is source-grounded AI the same as RAG?",
        answer:
          "RAG means retrieval-augmented generation. In plain English, it means the system retrieves relevant source material before generating an answer or draft. Source-grounded writing is the student-facing workflow built on that idea.",
      },
      {
        question: "Does source-grounded AI eliminate hallucinations?",
        answer:
          "No responsible tool should promise that. Source grounding can reduce risk by making source material visible and checkable, but students still need to verify final quotes, citations, paraphrases, and claims.",
      },
      {
        question: "How is ScholarMark different from a blank chatbot?",
        answer:
          "A blank chatbot starts from a prompt. ScholarMark starts from your source base: uploaded documents, project evidence, annotations, citation notes, web clips, and selected passages.",
      },
      {
        question: "How does ScholarMark help with quote context?",
        answer:
          "ScholarMark is built around finding passages inside your source base and keeping the surrounding context available, so you can check whether a quote says what your draft claims it says.",
      },
    ],
  },
  {
    title: "Academic Integrity",
    description: "Boundaries for responsible AI-assisted research writing.",
    items: [
      {
        question: "Is using AI for research writing cheating?",
        answer:
          "It depends on the assignment, instructor, and school policy. Using AI for planning, organization, revision, or evidence review may be allowed in one class and restricted in another. Always check the policy for your assignment.",
      },
      {
        question: "How can I use AI without losing ownership of my work?",
        answer:
          "Use AI to organize, question, outline, revise, and check your work, not to replace your thinking. Keep records of your sources, drafts, prompts, and changes.",
      },
      {
        question: "Should I disclose AI use?",
        answer:
          "Follow your course or institution policy. If disclosure is required, include what tool you used, how you used it, and what parts of the work were assisted.",
      },
      {
        question: "Does ScholarMark help beat AI detectors?",
        answer:
          "No. ScholarMark should never be positioned as a detector-evasion tool. It supports transparent, source-grounded, student-owned work.",
      },
    ],
  },
  {
    title: "Summer Thesis Head Start",
    description: "The summer workflow for theses, capstones, honors papers, and long projects.",
    items: [
      {
        question: "What is Summer Thesis Head Start?",
        answer:
          "Summer Thesis Head Start is a practical early-start workflow for students who want to make progress on a thesis, capstone, honors paper, senior seminar, research project, or long paper before fall gets busy.",
      },
      {
        question: "Who should join Summer Thesis Head Start?",
        answer:
          "Rising juniors and seniors with major research-heavy writing ahead are the main audience. It is also useful for students preparing for research methods, upper-level seminars, honors work, grad school writing, law school writing samples, or capstone projects.",
      },
      {
        question: "Do I need a topic already?",
        answer:
          "No. A good summer start can begin with narrowing a broad interest, building an initial source base, and turning early reading into a working research question.",
      },
      {
        question: "What does an eight-week plan look like?",
        answer:
          "Week 1: topic and starting sources. Week 2: source base. Week 3: research question. Week 4: quote bank. Week 5: working outline. Week 6: first section. Week 7: revision and gaps. Week 8: verification and fall plan.",
      },
    ],
  },
];

export function getArticle(slug: string | undefined): BlogArticle | undefined {
  return blogArticles.find((article) => article.slug === slug);
}

export function getRelatedArticles(currentSlug: string, limit = 3): BlogArticle[] {
  const current = getArticle(currentSlug);
  const candidates = blogArticles.filter((article) => article.slug !== currentSlug);

  if (!current) return candidates.slice(0, limit);

  return candidates
    .sort((left, right) => {
      const leftScore = left.category === current.category ? 0 : 1;
      const rightScore = right.category === current.category ? 0 : 1;
      return leftScore - rightScore;
    })
    .slice(0, limit);
}
