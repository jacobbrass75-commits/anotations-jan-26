import { sqlite } from "../server/db";
import { findTextRange, textsLooselyEqual } from "../server/textAnchors";

type AnnotationRow = {
  annotationId: string;
  projectName: string;
  projectDocumentId: string;
  startPosition: number;
  endPosition: number;
  highlightedText: string;
  fullText: string | null;
};

function parseArgs(): { userId: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const userIdFlagIndex = args.findIndex((arg) => arg === "--userId");
  const userId = userIdFlagIndex >= 0 ? args[userIdFlagIndex + 1] : "";
  if (!userId) {
    throw new Error("Usage: tsx scripts/backfill-annotation-positions.ts --userId <clerk_user_id> [--dry-run]");
  }
  return {
    userId,
    dryRun: args.includes("--dry-run"),
  };
}

function loadAnnotationsForUser(userId: string): AnnotationRow[] {
  return sqlite
    .prepare(
      `
      select
        pa.id as annotationId,
        p.name as projectName,
        pd.id as projectDocumentId,
        pa.start_position as startPosition,
        pa.end_position as endPosition,
        pa.highlighted_text as highlightedText,
        d.full_text as fullText
      from project_annotations pa
      join project_documents pd on pd.id = pa.project_document_id
      join projects p on p.id = pd.project_id
      join documents d on d.id = pd.document_id
      where p.user_id = ?
      order by p.name asc, pa.created_at asc
      `
    )
    .all(userId) as AnnotationRow[];
}

function main(): void {
  const { userId, dryRun } = parseArgs();
  const rows = loadAnnotationsForUser(userId);
  const updatePosition = sqlite.prepare(
    "update project_annotations set start_position = ?, end_position = ? where id = ?"
  );

  let unchanged = 0;
  let corrected = 0;
  let unmatched = 0;
  let skipped = 0;

  const unmatchedExamples: Array<{ annotationId: string; projectName: string; quote: string }> = [];

  const transaction = sqlite.transaction((annotations: AnnotationRow[]) => {
    for (const row of annotations) {
      const fullText = row.fullText || "";
      if (!fullText.trim() || !row.highlightedText.trim()) {
        skipped += 1;
        continue;
      }

      const currentSlice =
        row.startPosition >= 0 && row.endPosition > row.startPosition && row.endPosition <= fullText.length
          ? fullText.slice(row.startPosition, row.endPosition)
          : "";

      if (currentSlice && textsLooselyEqual(currentSlice, row.highlightedText)) {
        unchanged += 1;
        continue;
      }

      const matchedRange = findTextRange(fullText, row.highlightedText);
      if (!matchedRange) {
        unmatched += 1;
        if (unmatchedExamples.length < 10) {
          unmatchedExamples.push({
            annotationId: row.annotationId,
            projectName: row.projectName,
            quote: row.highlightedText.slice(0, 140),
          });
        }
        continue;
      }

      if (matchedRange.startPosition === row.startPosition && matchedRange.endPosition === row.endPosition) {
        unchanged += 1;
        continue;
      }

      corrected += 1;
      if (!dryRun) {
        updatePosition.run(matchedRange.startPosition, matchedRange.endPosition, row.annotationId);
      }
    }
  });

  transaction(rows);

  console.log(
    JSON.stringify(
      {
        userId,
        dryRun,
        total: rows.length,
        unchanged,
        corrected,
        unmatched,
        skipped,
        unmatchedExamples,
      },
      null,
      2
    )
  );
}

main();
