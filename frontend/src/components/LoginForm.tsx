"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, type FieldError } from "@/lib/api";
import { login } from "@/lib/auth";

interface FieldErrors {
  email?: string;
  password?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (email === "") errors.email = "Enter your email address.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
  if (password === "") errors.password = "Enter your password.";
  return errors;
}

/** Turns an API failure into field-level errors and/or one form-level message. */
function describeError(err: unknown): { fields: FieldErrors; form?: string } {
  if (!(err instanceof ApiError)) {
    return { fields: {}, form: "Something went wrong. Please try again." };
  }

  switch (err.code) {
    case "INVALID_CREDENTIALS":
      return { fields: {}, form: "Incorrect email or password." };

    case "RATE_LIMITED": {
      const seconds = (err.details as { retryAfterSeconds?: number } | undefined)
        ?.retryAfterSeconds;
      const minutes = seconds ? Math.ceil(seconds / 60) : undefined;
      const wait = minutes ? `in ${minutes} minute${minutes === 1 ? "" : "s"}` : "later";
      return { fields: {}, form: `Too many failed attempts. Please try again ${wait}.` };
    }

    case "VALIDATION_ERROR": {
      const fields: FieldErrors = {};
      for (const { path, message } of (err.details as FieldError[] | undefined) ?? []) {
        if (path === "email" || path === "password") fields[path] ??= message;
      }
      return Object.keys(fields).length > 0
        ? { fields }
        : { fields, form: "Please check your details and try again." };
    }

    default:
      return {
        fields: {},
        form:
          err.status === 0 || err.status >= 500
            ? "We couldn't reach the server. Please try again in a moment."
            : "Something went wrong. Please try again.",
      };
  }
}

const INPUT_CLASSES =
  "mt-1 block w-full rounded-md border px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-slate-900/20";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const trimmedEmail = email.trim();
    const errors = validate(trimmedEmail, password);
    setFieldErrors(errors);
    setFormError(undefined);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await login(trimmedEmail, password);
      router.replace("/");
    } catch (err) {
      const described = describeError(err);
      setFieldErrors(described.fields);
      setFormError(described.form);
      setPassword("");
      setSubmitting(false);
    }
  }

  return (
    // method="post": if JavaScript ever fails to load, a native submit must not
    // put the password in the URL (and so in history and server logs).
    <form method="post" onSubmit={handleSubmit} noValidate className="space-y-4">
      {formError && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {formError}
        </p>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
          className={`${INPUT_CLASSES} ${fieldErrors.email ? "border-red-400" : "border-slate-300"}`}
        />
        {fieldErrors.email && (
          <p id="email-error" className="mt-1 text-sm text-red-700">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={fieldErrors.password ? "password-error" : undefined}
          className={`${INPUT_CLASSES} ${fieldErrors.password ? "border-red-400" : "border-slate-300"}`}
        />
        {fieldErrors.password && (
          <p id="password-error" className="mt-1 text-sm text-red-700">
            {fieldErrors.password}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
