"use client";

import { useState } from "react";

type Status = "idle" | "submitting" | "ok" | "error";

export function NewsletterForm({ source }: { source: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    if (!email) {
      setStatus("error");
      setMessage("Email is required.");
      return;
    }
    setStatus("submitting");
    setMessage("");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Could not submit. Try again.");
      }
      setStatus("ok");
      setMessage("Thank you. You will hear from us monthly.");
      event.currentTarget.reset();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Submission failed.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="email"
          name="email"
          required
          placeholder="you@example.com"
          aria-label="Email address"
          className="flex-1 px-3 py-2 text-sm border rounded-sm bg-white"
          style={{ borderColor: "var(--color-consumer-border-strong)" }}
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          className="px-4 py-2 text-sm font-medium rounded-sm text-white disabled:opacity-60"
          style={{ background: "var(--color-consumer-rule)" }}
        >
          {status === "submitting" ? "…" : "Subscribe"}
        </button>
      </div>
      {message ? (
        <div
          className="text-xs"
          style={{
            color:
              status === "ok"
                ? "var(--color-consumer-ink-muted)"
                : "var(--color-consumer-accent)",
          }}
        >
          {message}
        </div>
      ) : null}
    </form>
  );
}
