import skillsOnly from "../../../integrations/scholarmark-plugin/skills-only/plugin.json";
import { claudeSkillZipName } from "../../../integrations/scholarmark-plugin/tools/claude-skill.mjs";
import { guidesFixtureDir } from "../config/release";

/**
 * The Citation Audit skill download offered on one guide. The ZIP is built from the
 * canonical skill by the `scholarmark-skill-download` integration in astro.config.ts and
 * written to `downloads/` in the build; the Express marketing handler serves that exact
 * file on the canonical host only.
 */
export const SKILL_DOWNLOAD_GUIDE = "how-to-verify-ai-generated-citations";
export const skillVersion: string = skillsOnly.version;
export const skillZipName: string = claudeSkillZipName(skillVersion);
export const skillDownloadPath = `/downloads/${skillZipName}`;

export function showsSkillDownload(slug: string): boolean {
  return slug === SKILL_DOWNLOAD_GUIDE;
}

/** Fails a real build if the guide was renamed or removed, so the download can't silently vanish. */
export function assertSkillDownloadGuideExists(slugs: string[]): void {
  if (guidesFixtureDir) return;
  if (!slugs.includes(SKILL_DOWNLOAD_GUIDE)) {
    throw new Error(
      `The skill download points at a guide that doesn't exist: ${SKILL_DOWNLOAD_GUIDE}`,
    );
  }
}
