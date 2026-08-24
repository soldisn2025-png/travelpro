"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

// Server actions that throw used to render Next's bare crash page with no way
// back. This keeps the user in the app and gives them a retry.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled app error", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-5 py-12">
      <div className="border border-zinc-200 bg-white p-6">
        <div className="inline-flex h-10 w-10 items-center justify-center bg-amber-100 text-amber-800">
          <AlertTriangle size={20} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-950">
          That did not save
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          Something went wrong on the last action. Your trip is safe — nothing
          was changed. Try again, and if it keeps happening check that every
          field on the form was filled in.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-10 items-center border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
          >
            Back to trips
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-5 text-xs text-zinc-400">Reference: {error.digest}</p>
        ) : null}
      </div>
    </main>
  );
}
