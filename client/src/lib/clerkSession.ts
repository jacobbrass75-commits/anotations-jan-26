import type { SetActive } from "@clerk/shared/types";

interface ActivateClerkSessionOptions {
  setActive: SetActive;
  sessionId: string;
  redirectUrl: string;
  taskFallbackUrl: string;
  assign?: (url: string) => void;
}

export async function activateClerkSession({
  setActive,
  sessionId,
  redirectUrl,
  taskFallbackUrl,
  assign = (url) => window.location.assign(url),
}: ActivateClerkSessionOptions): Promise<void> {
  await setActive({
    session: sessionId,
    navigate: async ({ session }) => {
      assign(session.currentTask ? taskFallbackUrl : redirectUrl);
    },
  });
}
