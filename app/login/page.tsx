import { Suspense } from "react";

// searchParams is runtime data; reading it inside Suspense keeps the page shell prerenderable.
async function LoginError({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const failed = (await searchParams).e !== undefined;
  return failed ? (
    <p role="alert" className="text-ui text-danger">
      That password didn&rsquo;t match. Try again.
    </p>
  ) : null;
}

export default function Login({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form
        method="post"
        action="/api/login"
        className="grid w-full max-w-sm gap-4 rounded-2xl border border-line bg-surface p-6"
      >
        <h1 className="text-section font-semibold tracking-tight">Home AC</h1>
        <label className="block text-label font-medium text-muted">
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            className="mt-1.5 h-11 w-full rounded-lg border border-line bg-raised px-3 text-base text-ink transition-colors hover:border-muted"
          />
        </label>
        <Suspense>
          <LoginError searchParams={searchParams} />
        </Suspense>
        <button className="h-11 rounded-lg bg-accent font-medium text-accent-ink transition-opacity hover:opacity-90 active:opacity-80">
          Sign in
        </button>
      </form>
    </main>
  );
}
