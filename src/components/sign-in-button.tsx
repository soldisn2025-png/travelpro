"use client";

import { createClient } from "@/lib/supabase/client";

export function SignInButton() {
  async function signIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <button
      type="button"
      onClick={signIn}
      className="inline-flex h-10 items-center justify-center bg-zinc-950 px-4 text-sm font-medium text-white hover:bg-zinc-800"
    >
      Sign in with Google
    </button>
  );
}
