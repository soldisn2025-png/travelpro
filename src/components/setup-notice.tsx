export function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-5 py-12">
      <div className="border border-amber-300 bg-amber-50 p-6 text-amber-950">
        <p className="text-sm font-semibold uppercase tracking-wide">
          Supabase setup needed
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Your Travel Pro is installed.
        </h1>
        <p className="mt-4 text-sm leading-6">
          Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
          `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`, then run
          `supabase/migrations/001_travelpro_v1.sql`.
        </p>
      </div>
    </main>
  );
}
