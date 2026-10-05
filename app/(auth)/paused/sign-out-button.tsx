"use client";

import { useTransition } from "react";
import { signOut } from "@/src/lib/auth/sign-out";
import { Button } from "@/components/ui/button";

export default function SignOutButton() {
  const [isPending, startTransition] = useTransition();
  return (
    <Button type="button" variant="outline" disabled={isPending} onClick={() => startTransition(() => signOut())}>
      {isPending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
