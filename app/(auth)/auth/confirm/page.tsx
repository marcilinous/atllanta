// /auth/confirm — where the password-reset email links to. GET here must be
// side-effect free (email link scanners prefetch it), so this Server
// Component only reads the query string; it never calls verifyOtp itself.
// The actual verification runs from ConfirmForm's button press.
import type { Metadata } from "next";
import Link from "next/link";
import ConfirmForm from "./confirm-form";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false },
};

function readParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const params = await searchParams;
  const tokenHash = readParam(params.token_hash);
  const type = readParam(params.type);

  if (!tokenHash || type !== "recovery") {
    return (
      <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
        <h1 className="text-2xl font-semibold">Reset password</h1>
        <p className="text-sm text-muted-foreground">
          This reset link is invalid or has expired. Request a new one from the sign-in page.
        </p>
        <Link href="/login" className="text-sm text-primary hover:underline">
          Back to sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Reset password</h1>
      <p className="text-sm text-muted-foreground">Confirm you want to reset your password.</p>
      <ConfirmForm tokenHash={tokenHash} />
    </main>
  );
}
