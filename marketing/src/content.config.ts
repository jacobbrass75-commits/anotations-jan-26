import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { guidesContentDir } from "./config/release";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepts `published: 2026-11-05` (YAML parses it as a Date) or the quoted
 * string form, and normalizes both to a validated `YYYY-MM-DD` string.
 */
const isoDay = z
  .union([z.string().trim(), z.date()])
  .transform((value, ctx) => {
    const day = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    const parsed = new Date(`${day}T00:00:00Z`);
    if (!ISO_DAY.test(day) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
      ctx.addIssue({ code: "custom", message: `Expected a calendar date as YYYY-MM-DD, got "${day}"` });
      return z.NEVER;
    }
    return day;
  });

/**
 * Public guides are authored as flat Markdown/MDX files in src/content/guides/.
 * The file name (minus extension) becomes the URL: /guides/<file-name>/.
 */
const guides = defineCollection({
  loader: glob({ pattern: "*.{md,mdx}", base: guidesContentDir }),
  schema: z
    .object({
      title: z.string().trim().min(1).max(120),
      description: z.string().trim().min(1).max(300),
      category: z.string().trim().min(1).max(60),
      published: isoDay,
      updated: isoDay.optional(),
    })
    .refine((guide) => !guide.updated || guide.updated >= guide.published, {
      message: "`updated` must be on or after `published`",
      path: ["updated"],
    }),
});

export const collections = { guides };
