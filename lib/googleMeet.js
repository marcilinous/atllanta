// Creates a Google Calendar event with auto-generated Google Meet link.
// Requires a Google Cloud service account with Calendar API enabled.
// For Google Workspace: enable domain-wide delegation so the service account
// can create events on the manager's calendar.
//
// Env vars:
//   GOOGLE_CLIENT_EMAIL  — service account email
//   GOOGLE_PRIVATE_KEY   — PEM private key (with \n newlines)
//   GOOGLE_CALENDAR_ID   — calendar to create events on (default: "primary")
//                          For Workspace, set to the manager's email.

import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

export async function createMeetEvent({ title, description, startTime, endTime, attendees, impersonateEmail }) {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) return null;

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
    subject: impersonateEmail || undefined,
  });

  const calendar = google.calendar({ version: "v3", auth });

  const event = {
    summary: title,
    description,
    start: { dateTime: startTime, timeZone: "Asia/Kolkata" },
    end: { dateTime: endTime, timeZone: "Asia/Kolkata" },
    attendees: attendees.filter(Boolean).map((email) => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: `atllanta-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

  const res = await calendar.events.insert({
    calendarId,
    resource: event,
    conferenceDataVersion: 1,
    sendUpdates: "all",
  });

  const meetLink = res.data?.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video"
  )?.uri;

  return {
    eventId: res.data.id,
    meetLink: meetLink || res.data.hangoutLink || null,
    htmlLink: res.data.htmlLink,
  };
}
