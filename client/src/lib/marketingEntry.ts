import { isScholarMarkMarketingHost } from "../../../shared/paidInstagramEntry";

export {
  getPaidInstagramSignupRedirect,
  isPaidInstagramCampaign,
  isPaidInstagramDirectSignup,
} from "../../../shared/paidInstagramEntry";

const FAST_MARKETING_PATHS = ["/", "/start", "/summer", "/invite"];

export function isFastMarketingEntry(hostname: string, pathname: string): boolean {
  if (!isScholarMarkMarketingHost(hostname)) return false;
  return FAST_MARKETING_PATHS.some(
    (path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)),
  );
}
