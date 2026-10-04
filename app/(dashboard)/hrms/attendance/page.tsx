import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { featureContext } from "@/src/lib/auth/permissions";
import { loadMyAttendance } from "@/src/lib/hrms/attendance/queries";
import TodayCard from "./today-card";
import MyDays from "./my-days";
import MyCorrections from "./my-corrections";
import { formatDate } from "../format";

export default async function MyAttendancePage() {
  if (!(await getSessionUser())) redirect("/login");
  // Both gates: the `me` module is on for the org and this person may see it.
  const ctx = await featureContext("me", "me", "view");
  if (!ctx) return <NotAvailable />;
  const data = await loadMyAttendance(ctx);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Today · {formatDate(data.today)}</h2>
        <TodayCard today={data.todayRow} timeZone={data.timeZone} />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Last 30 days</h2>
          <p className="text-sm text-muted-foreground">
            If a time is wrong, ask for a correction. Your manager approves it; an owner&rsquo;s or admin&rsquo;s goes to
            an admin or another owner.
          </p>
        </div>
        <MyDays days={data.days} timeZone={data.timeZone} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">My corrections</h2>
        <MyCorrections corrections={data.corrections} timeZone={data.timeZone} />
      </section>
    </div>
  );
}

function NotAvailable() {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <h2 className="text-base font-semibold">Attendance isn&rsquo;t available to you</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your organisation hasn&rsquo;t switched it on, or it&rsquo;s hidden for your role. Ask an owner or admin.
      </p>
    </div>
  );
}
