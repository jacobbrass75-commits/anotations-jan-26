---
title: "How to Verify AI-Generated Citations: A Five-Level Check With Free Tools"
description: "A step-by-step procedure for checking citations from ChatGPT, Claude, or any AI tool: does the work exist, is the metadata right, does it say what you claim, is the quote exact, has it been retracted?"
category: "Citation guides"
published: "2026-11-05"
---

Treat every citation an AI tool gives you as a **lead**, not a reference. Some will be perfect. Some will be real works with wrong details. Some will be invented, or real but irrelevant to your claim. You can't tell which by looking at them, so you check.

Here's a procedure with five levels. Each level catches a different kind of failure, and you can stop early when a citation fails.

## Level 1: Does the work exist?

**For anything with a DOI:** paste it after `https://doi.org/`. The DOI system describes DOIs as [persistent identifiers](https://www.doi.org/the-identifier/what-is-a-doi/) that are free to resolve. A real DOI takes you to the publisher's page. A fabricated one usually returns an error. Occasionally a fabricated DOI resolves to an unrelated work, so always compare the title.

**For articles without a DOI, or to search by title:** use [Crossref Metadata Search](https://search.crossref.org/), which searches metadata for journal articles, books, datasets, and more. Search the exact title in quotation marks.

**For books:** search [WorldCat](https://search.worldcat.org/), which finds items in libraries, or your own library's catalog.

**Also useful:** [Google Scholar](https://scholar.google.com/). If a supposedly influential paper has no "Cited by" trail at all, look harder.

**Fails Level 1 if:** you can't find the work in any of these. Don't cite it. Don't "fix" it by finding a similar-sounding real paper and swapping it in either. That changes your evidence without telling you.

## Level 2: Is the metadata right?

Real works often come back with errors: the wrong year, a missing co-author, the wrong journal, wrong pages, or a book chapter cited as if it were a whole book.

Compare **each field** against the publisher's page or the catalog record: authors (all of them, in order), year, title, container (journal or book), volume, issue, pages, and DOI.

**A real example of why this is fiddly.** Purdue OWL's Chicago example cites Ian Hacking's *The Social Construction of What?* as Harvard University Press, 1999. The DOI that Crossref returns for that title (10.2307/j.ctv1bzfp1z) has a record that lists a print date of November 15, 2000, and the author name in all capitals. Neither is necessarily wrong. Records can describe a particular printing or digitized edition. The lesson is that **you cite the edition you actually used**, and you fix capitalization rather than copying a database record as-is. See [tracking editions, translations, and versions](/guides/tracking-editions-translations-versions).

## Level 3: Does the source support your claim?

This is where most real-but-wrong citations fail, and it's the level people skip.

Open the source and find the passage that supports your sentence. Then ask:

- Does it say **what** you say? Not something adjacent.
- Is the claim the **source's own finding**, or something it cites from elsewhere? If it's cited from elsewhere, see [citing a source quoted in another source](/guides/citing-a-source-quoted-in-another-source).
- Does the source **qualify** the claim in ways your sentence drops (a subgroup, a time period, "may," "in this sample")?

**Fails Level 3 if:** you can't point to a passage. Remove the citation and either find real support or soften the claim.

## Level 4: Is the quotation exact?

If the AI gave you a direct quotation, find it in the source, word for word.

- Search the PDF for a distinctive three- or four-word phrase from the quote, not the whole thing. Small wording changes defeat a full-sentence search.
- Check the page number against the **printed** page, not the PDF viewer's page count.
- If you find a close paraphrase but not the exact words, it's not a quotation. Quote the real wording or paraphrase in your own words.

## Level 5: Has it been retracted or corrected?

Crossref [acquired the Retraction Watch database](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/) in 2023 and made it publicly available. It says the database collects retractions from publisher websites and is updated every working day. For anything central to your argument, especially in medicine and the sciences, check the article's own page for correction or retraction notices, and check the database.

## Worked example: three AI-suggested citations

*(The citations below are invented to illustrate failure types.)*

You ask an AI tool for support for the claim "Peer tutoring improves first-year retention." It returns:

1. **Hamid & Cole (2019), *Journal of College Retention*, 21(3), 201–219.**
   - Level 1: a title search on Crossref finds it, so it exists.
   - Level 2: the year is 2018 and there's a third author. Fix the metadata.
   - Level 3: the article finds improved *course completion*, not retention. **Fails.** Don't cite it for retention.

2. **Prieto (2021), "Peer Models and Persistence," *Higher Education Quarterly*.**
   - Level 1: no Crossref match, no WorldCat match, and the journal's archive for 2021 shows no such title. **Fails.** It's likely fabricated. Delete it.

3. **Nwosu et al. (2020)**, with a direct quote: "retention rose by eleven points among tutored students."
   - Levels 1–2: it exists, and the metadata is correct.
   - Level 3: it does report a retention effect. Pass.
   - Level 4: the exact sentence isn't in the article. Page 9 says retention was "11 percentage points higher among students who attended four or more sessions." **Partial fail.** Use the real wording, with its condition.

You end up with one usable citation out of three, and the sentence it supports is narrower than the one you started with. That's a normal result.

## Make the check fast next time

- **Keep the evidence, not just the reference.** When a source passes Level 3, save the supporting passage with a note on which claim it supports. Then you never re-verify the same citation twice.
- **Record the printed page when you save the passage**, not when you write the citation.
- **Keep a "rejected" note** for citations that failed, so they don't creep back in from an old chat.

In ScholarMark, once a source passes, upload it to your project, highlight the supporting passage as Evidence or Key Quote, and write the claim and page in the note. If you work in Claude or ChatGPT, ScholarMark's connector can save the source and exact-quote highlights for you. Quotes it can't find in the stored source text are reported back instead of saved, which is a useful automatic Level 4 check. See [using Claude or ChatGPT with your source library](/guides/use-claude-or-chatgpt-with-your-source-library).

## If your course allows AI use

Check whether you also need to disclose or cite the AI tool itself. Both [APA](https://apastyle.apa.org/blog/how-to-cite-chatgpt) and [MLA](https://style.mla.org/citing-generative-ai/) publish guidance on citing generative AI. Your instructor's policy comes first.

## Next step

Run the five levels on every AI-suggested citation in your current draft. Then [create a ScholarMark project](https://app.scholarmark.ai/sign-up) and save the passages that passed, so the verified evidence is what you draft from.
