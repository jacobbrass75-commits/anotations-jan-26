import { getCollection, type CollectionEntry } from "astro:content";

export type Guide = CollectionEntry<"guides">;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Newest first by last meaningful change, then by title for a stable order. */
export async function getGuides(): Promise<Guide[]> {
  const guides = await getCollection("guides");
  for (const guide of guides) {
    if (!SLUG.test(guide.id)) {
      throw new Error(
        `Guide "${guide.id}" needs a lowercase, hyphenated file name (for example "organize-research-sources.md").`,
      );
    }
  }
  return guides.sort(
    (a, b) =>
      lastChanged(b).localeCompare(lastChanged(a)) || a.data.title.localeCompare(b.data.title),
  );
}

export function lastChanged(guide: Guide): string {
  return guide.data.updated ?? guide.data.published;
}

export function guidePath(guide: Guide): string {
  return `/guides/${guide.id}/`;
}

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function formatDay(day: string): string {
  return dayFormatter.format(new Date(`${day}T00:00:00Z`));
}

export function readingMinutes(body: string | undefined): number | null {
  if (!body) return null;
  const words = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return words > 0 ? Math.max(1, Math.round(words / 230)) : null;
}
