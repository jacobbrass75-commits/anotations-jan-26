# ScholarMark internal blog generator

This folder is reserved for ScholarMark's private blog-production tool and its reviewed source packets.

## Product boundary

- The customer-facing ScholarMark application does not expose this tool.
- The marketing site keeps its public `/blog` index and article pages.
- No blog-generator link belongs in the signed-in dashboard or account experience.
- The generator runs as a separate local/internal service with its own storage and configuration.
- iBoltMark code may be adapted here, but iBoltMark data, posts, products, photos, tokens, keys, and business configuration must never be copied.

## Intended workflow

The operator tool researches, drafts, reviews, quality-checks, and prepares ScholarMark marketing posts for publication. Source packets under `source-packets/` record approved claims, evidence paths, and limitations for reviewed topics.

Publishing output may appear on the public marketing blog after operator review. The generator itself remains internal and is not bundled into the customer application.
