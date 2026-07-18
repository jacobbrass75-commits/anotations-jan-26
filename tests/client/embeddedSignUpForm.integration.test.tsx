// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SignUpResource } from "@clerk/shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerkHook = vi.hoisted(() => ({
  current: undefined as unknown,
}));

vi.mock("@clerk/clerk-react", () => ({
  useSignUp: () => clerkHook.current,
}));

vi.mock("@/lib/siteAnalytics", () => ({
  trackSiteEvent: vi.fn(),
}));

vi.mock("@/lib/signupAnalyticsState", () => ({
  markSignupInProgress: vi.fn(() => true),
}));

import { EmbeddedSignUpForm } from "../../client/src/components/auth/EmbeddedSignUpForm";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function asSignUpResource(value: Record<string, unknown>): SignUpResource {
  return value as unknown as SignUpResource;
}

function updateInput(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!valueSetter) throw new Error("HTML input value setter is unavailable");
  valueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

async function flushReact(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("embedded signup component flow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("creates, verifies, and activates once across repeated Clerk snapshots", async () => {
    const trace: string[] = [];
    const createResult = deferred<SignUpResource>();
    const prepareResult = deferred<SignUpResource>();
    const attemptResult = deferred<SignUpResource>();
    const activationResult = deferred<void>();

    const setActive = vi.fn((_params: unknown) => {
      trace.push("setActive");
      return activationResult.promise;
    });

    const completeResource = asSignUpResource({
      status: "complete",
      createdSessionId: "sess_test",
      emailAddress: "student@example.edu",
      missingFields: [],
      unverifiedFields: [],
    });
    const verificationResource = asSignUpResource({
      status: "missing_requirements",
      createdSessionId: null,
      emailAddress: "student@example.edu",
      missingFields: [],
      unverifiedFields: ["email_address"],
      prepareEmailAddressVerification: vi.fn((_params: unknown) => {
        trace.push("prepare");
        return prepareResult.promise;
      }),
      attemptEmailAddressVerification: vi.fn((_params: unknown) => {
        trace.push("attempt");
        return attemptResult.promise;
      }),
    });
    const detailsResource = asSignUpResource({
      status: "missing_requirements",
      createdSessionId: null,
      emailAddress: null,
      missingFields: ["email_address", "password"],
      unverifiedFields: [],
      create: vi.fn((_params: unknown) => {
        trace.push("create");
        return createResult.promise;
      }),
    });

    clerkHook.current = { isLoaded: true, signUp: detailsResource, setActive };
    await act(async () => {
      root.render(<EmbeddedSignUpForm redirectUrl="/pricing?onboarding=1" />);
    });

    const emailInput = container.querySelector<HTMLInputElement>(
      '[data-testid="embedded-signup-email"]',
    );
    const passwordInput = container.querySelector<HTMLInputElement>(
      '[data-testid="embedded-signup-password"]',
    );
    expect(emailInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();

    await act(async () => {
      updateInput(emailInput!, "  student@example.edu  ");
      updateInput(passwordInput!, "correct-horse");
    });

    const continueButton = buttonWithText(container, "Continue with email");
    await act(async () => {
      continueButton.click();
      await flushReact();
    });
    expect(continueButton.disabled).toBe(true);
    continueButton.click();
    expect(detailsResource.create).toHaveBeenCalledTimes(1);
    expect(detailsResource.create).toHaveBeenCalledWith({
      emailAddress: "student@example.edu",
      password: "correct-horse",
    });

    clerkHook.current = { isLoaded: true, signUp: verificationResource, setActive };
    await act(async () => {
      createResult.resolve(verificationResource);
      await flushReact();
    });
    expect(verificationResource.prepareEmailAddressVerification).toHaveBeenCalledWith({
      strategy: "email_code",
    });
    expect(trace).toEqual(["create", "prepare"]);

    await act(async () => {
      prepareResult.resolve(verificationResource);
      await flushReact();
    });

    const codeInput = container.querySelector<HTMLInputElement>(
      '[data-testid="embedded-signup-code"]',
    );
    expect(codeInput).not.toBeNull();
    await act(async () => updateInput(codeInput!, "123456"));

    const verifyButton = buttonWithText(container, "Verify and open ScholarMark");
    const resendButton = buttonWithText(container, "Resend code");
    await act(async () => {
      verifyButton.click();
      await flushReact();
    });
    expect(verifyButton.disabled).toBe(true);
    expect(resendButton.disabled).toBe(true);
    verifyButton.click();
    resendButton.click();
    expect(verificationResource.attemptEmailAddressVerification).toHaveBeenCalledTimes(1);
    expect(verificationResource.attemptEmailAddressVerification).toHaveBeenCalledWith({
      code: "123456",
    });
    expect(verificationResource.prepareEmailAddressVerification).toHaveBeenCalledTimes(1);

    clerkHook.current = { isLoaded: true, signUp: completeResource, setActive };
    await act(async () => {
      attemptResult.resolve(completeResource);
      await flushReact();
    });
    expect(setActive).toHaveBeenCalledTimes(1);
    expect(setActive.mock.calls[0]?.[0]).toMatchObject({ session: "sess_test" });

    await act(async () => {
      activationResult.resolve();
      await flushReact();
    });

    for (let index = 0; index < 3; index += 1) {
      clerkHook.current = {
        isLoaded: true,
        signUp: asSignUpResource({ ...completeResource }),
        setActive,
      };
      await act(async () => {
        root.render(<EmbeddedSignUpForm redirectUrl="/pricing?onboarding=1" />);
        await flushReact();
      });
    }

    expect(trace).toEqual(["create", "prepare", "attempt", "setActive"]);
    expect(setActive).toHaveBeenCalledTimes(1);
  });

  it("latches session recovery after activation fails instead of retrying or blaming the code", async () => {
    const setActive = vi.fn(async () => {
      throw new Error("session activation failed");
    });
    const completeResource = asSignUpResource({
      status: "complete",
      createdSessionId: "sess_recovery",
      emailAddress: "student@example.edu",
      missingFields: [],
      unverifiedFields: [],
    });
    clerkHook.current = { isLoaded: true, signUp: completeResource, setActive };

    await act(async () => {
      root.render(<EmbeddedSignUpForm redirectUrl="/dashboard" />);
      await flushReact();
    });

    expect(container.textContent).toContain("Finish secure account setup");
    expect(container.textContent).toContain("Continue secure account setup");
    expect(container.textContent).not.toContain("That code could not be verified");
    expect(setActive).toHaveBeenCalledTimes(1);

    clerkHook.current = { isLoaded: false, signUp: completeResource, setActive };
    await act(async () => {
      root.render(<EmbeddedSignUpForm redirectUrl="/dashboard" />);
    });
    clerkHook.current = {
      isLoaded: true,
      signUp: asSignUpResource({ ...completeResource }),
      setActive,
    };
    await act(async () => {
      root.render(<EmbeddedSignUpForm redirectUrl="/dashboard" />);
      await flushReact();
    });

    expect(container.textContent).toContain("Finish secure account setup");
    expect(setActive).toHaveBeenCalledTimes(1);
  });

  it("does not offer a reload when Clerk becomes temporarily unloaded after bootstrap", async () => {
    vi.useFakeTimers();
    const detailsResource = asSignUpResource({
      status: "missing_requirements",
      createdSessionId: null,
      emailAddress: null,
      missingFields: ["email_address", "password"],
      unverifiedFields: [],
    });
    const setActive = vi.fn();
    clerkHook.current = { isLoaded: true, signUp: detailsResource, setActive };
    await act(async () => {
      root.render(<EmbeddedSignUpForm redirectUrl="/dashboard" />);
    });

    clerkHook.current = { isLoaded: false, signUp: detailsResource, setActive };
    await act(async () => {
      root.render(<EmbeddedSignUpForm redirectUrl="/dashboard" />);
      vi.advanceTimersByTime(8_001);
    });

    expect(container.textContent).not.toContain("Retry secure signup");
    expect(container.textContent).toContain("Use the secure hosted signup page");
  });
});
