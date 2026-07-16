import type {
  EmailCodeFactor,
  SignInResource,
  SignUpField,
  SignUpResource,
} from "@clerk/shared/types";

export type EmbeddedSignUpStep =
  | "details"
  | "profile"
  | "verification"
  | "unsupported"
  | "complete";

const PROFILE_FIELDS = new Set<SignUpField>(["first_name", "last_name", "legal_accepted"]);

export function getRequiredProfileFields(
  signUp: Pick<SignUpResource, "missingFields">,
): SignUpField[] {
  return signUp.missingFields.filter((field) => PROFILE_FIELDS.has(field));
}

export function deriveEmbeddedSignUpStep(
  signUp:
    | Pick<SignUpResource, "emailAddress" | "missingFields" | "status" | "unverifiedFields">
    | null
    | undefined,
): EmbeddedSignUpStep {
  if (!signUp || signUp.status === "abandoned") return "details";
  if (signUp.status === "complete") return "complete";
  if (!signUp.emailAddress || signUp.missingFields.includes("password")) return "details";
  if (getRequiredProfileFields(signUp).length > 0) return "profile";
  if (signUp.missingFields.length > 0) return "unsupported";
  if (signUp.unverifiedFields.includes("email_address")) return "verification";
  return "unsupported";
}

export function findEmailCodeSecondFactor(
  signIn: Pick<SignInResource, "supportedSecondFactors">,
): EmailCodeFactor | null {
  const factor = signIn.supportedSecondFactors?.find(
    (candidate): candidate is EmailCodeFactor => candidate.strategy === "email_code",
  );
  return factor ?? null;
}
