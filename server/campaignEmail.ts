import type { CampaignSignupForm } from "@shared/schema";
import { createLogger } from "./logger";

const logger = createLogger("campaignEmail");

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "ScholarMark <hello@scholarmark.ai>";
const DEFAULT_REPLY_TO = "support@scholarmark.ai";
const DEFAULT_MARKETING_BASE_URL = "https://scholarmark.ai";

interface CampaignSignupEmailInput {
  form: CampaignSignupForm;
  referralCode: string;
}

interface ResendEmailPayload {
  from: string;
  to: string[];
  reply_to?: string[];
  subject: string;
  html: string;
  text: string;
}

function getMarketingBaseUrl(): string {
  const configured =
    process.env.MARKETING_BASE_URL ||
    process.env.PUBLIC_SITE_URL ||
    process.env.PUBLIC_BASE_URL ||
    DEFAULT_MARKETING_BASE_URL;
  return configured.trim().replace(/\/+$/, "") || DEFAULT_MARKETING_BASE_URL;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function labelClassYear(value: CampaignSignupForm["classYear"]): string {
  switch (value) {
    case "rising_junior":
      return "rising junior";
    case "rising_senior":
      return "rising senior";
    case "other":
      return "student";
    default:
      return "student";
  }
}

function labelPaperType(value: CampaignSignupForm["paperType"]): string {
  switch (value) {
    case "senior_thesis":
      return "senior thesis";
    case "capstone":
      return "capstone";
    case "honors_paper":
      return "honors paper";
    case "research_seminar":
      return "research seminar paper";
    case "grad_writing_sample":
      return "grad school or law school writing sample";
    case "not_sure":
      return "long paper";
    default:
      return "long paper";
  }
}

function buildSignupEmail({ form, referralCode }: CampaignSignupEmailInput): ResendEmailPayload {
  const baseUrl = getMarketingBaseUrl();
  const referralUrl = `${baseUrl}/invite/${encodeURIComponent(referralCode)}`;
  const planUrl = `${baseUrl}/sign-up?redirect=${encodeURIComponent("/summer/onboarding")}`;
  const firstName = form.name.trim().split(/\s+/)[0] || "there";
  const projectType = labelPaperType(form.paperType);
  const classYear = labelClassYear(form.classYear);
  const safeFirstName = escapeHtml(firstName);
  const safeSchool = escapeHtml(form.school);
  const safeProjectType = escapeHtml(projectType);
  const safeClassYear = escapeHtml(classYear);
  const safePlanUrl = escapeHtml(planUrl);
  const safeReferralUrl = escapeHtml(referralUrl);

  const subject = "Your ScholarMark summer writing plan is ready";
  const text = `Hi ${firstName},

You're on the ScholarMark Summer Thesis Head Start list.

We saved your ${projectType} plan for ${form.school}. When you create your account, ScholarMark will help you turn your source base into a research question, working outline, and revision plan.

Start your plan:
${planUrl}

Your invite link:
${referralUrl}

ScholarMark supports student-owned research and writing. It helps with planning, source organization, feedback, and revision support; it does not replace your work or write assignments for you.

Questions or opt-out requests: reply to this email or contact support@scholarmark.ai.

- ScholarMark`;

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f8f7f4;color:#211f1c;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <p style="margin:0 0 20px;color:#cf5f73;font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;">ScholarMark Summer Head Start</p>
      <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:36px;line-height:1.05;color:#211f1c;">Your summer writing plan is ready.</h1>
      <p style="margin:0 0 18px;font-size:16px;line-height:1.55;color:#6c625c;">Hi ${safeFirstName}, you are on the early student access list. We saved your ${safeProjectType} plan for ${safeSchool} as a ${safeClassYear}.</p>
      <div style="margin:24px 0;padding:20px;border:1px solid #e5dfd8;background:#fffdf9;border-radius:8px;">
        <p style="margin:0 0 10px;font-size:14px;font-weight:700;color:#211f1c;">What happens next</p>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#6c625c;">Create your account and ScholarMark will help you turn sources into a research question, working outline, and revision plan. Feedback and revision support only; your writing stays yours.</p>
      </div>
      <p style="margin:26px 0;">
        <a href="${safePlanUrl}" style="display:inline-block;background:#cf5f73;color:#fff;text-decoration:none;padding:13px 20px;border-radius:4px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">Create my writing plan</a>
      </p>
      <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#211f1c;">Your invite link</p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#6c625c;"><a href="${safeReferralUrl}" style="color:#4f78a8;">${safeReferralUrl}</a></p>
      <p style="margin:0;font-size:12px;line-height:1.55;color:#8a817a;">You are receiving this because you requested ScholarMark early student access. Reply to opt out or contact support@scholarmark.ai.</p>
    </div>
  </body>
</html>`;

  const from = (process.env.CAMPAIGN_EMAIL_FROM || process.env.EMAIL_FROM || DEFAULT_FROM).trim();
  const replyTo = (process.env.CAMPAIGN_EMAIL_REPLY_TO || DEFAULT_REPLY_TO).trim();

  return {
    from,
    to: [form.email],
    reply_to: replyTo ? [replyTo] : undefined,
    subject,
    html,
    text,
  };
}

async function sendResendEmail(payload: ResendEmailPayload): Promise<"sent" | "skipped"> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey || process.env.CAMPAIGN_EMAIL_DISABLED === "1") {
    return "skipped";
  }

  const response = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend email failed with ${response.status}: ${body.slice(0, 500)}`);
  }

  return "sent";
}

export async function sendCampaignSignupEmail(input: CampaignSignupEmailInput): Promise<void> {
  const payload = buildSignupEmail(input);
  try {
    const status = await sendResendEmail(payload);
    if (status === "skipped") {
      logger.info({ to: payload.to }, "Campaign email skipped; Resend is not configured");
      return;
    }
    logger.info({ to: payload.to }, "Campaign signup email sent");
  } catch (error) {
    logger.error({ err: error, to: payload.to }, "Campaign signup email failed");
  }
}
