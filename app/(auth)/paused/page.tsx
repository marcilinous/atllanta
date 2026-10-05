// Where a blocked company lands (v1.13.0): its trial has ended or Atllanta
// paused it. The database already refuses everything; this page explains.
// Owners and admins get the contact; everyone else is told to ask them.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { getOrgAccess } from "@/src/lib/platform/access";
import { PLATFORM_CONTACT } from "@/src/lib/platform/contact";
import { formatDate } from "../../(dashboard)/hrms/format";
import SignOutButton from "./sign-out-button";

export const metadata: Metadata = {
  title: "Access paused · Atllanta",
};

export default async function PausedPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const access = await getOrgAccess(user.id);
  if (!access) redirect("/start");
  if (access.state === "ok") redirect("/");

  const canContact = access.role === "owner" || access.role === "admin";
  const ended = access.trialEndsAt ? formatDate(access.trialEndsAt.slice(0, 10)) : null;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-4 py-16 sm:px-6">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">
          {access.state === "trial_ended" ? "Your free trial has ended" : "Access is paused"}
        </h1>
        {canContact ? (
          <>
            <p className="text-sm">
              {access.state === "trial_ended"
                ? `Your free trial of Atllanta for ${access.orgName} ended${ended ? ` on ${ended}` : ""}. To keep using it, contact us:`
                : `Access to Atllanta for ${access.orgName} is paused. Contact us:`}
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              <li>
                Email:{" "}
                <a className="text-primary hover:underline" href={`mailto:${PLATFORM_CONTACT.email}`}>
                  {PLATFORM_CONTACT.email}
                </a>
              </li>
              <li>
                Phone:{" "}
                <a className="text-primary hover:underline" href={`tel:+91${PLATFORM_CONTACT.phone}`}>
                  {PLATFORM_CONTACT.phone}
                </a>
                {" · "}
                <a className="text-primary hover:underline" href={PLATFORM_CONTACT.whatsapp} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground">
              Nothing has been deleted. Everything is back as soon as access is restored.
            </p>
          </>
        ) : (
          <p className="text-sm">Your company&rsquo;s access to Atllanta is paused. Please ask your admin.</p>
        )}
        <div>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
