// Creates a Google Calendar event with auto-generated Google Meet link.
// Uses the slot creator's OAuth tokens (connected via Settings → Google Calendar).
// Falls back to service account if configured. Returns null if neither available.

import { google } from "googleapis";
import { supabaseAdmin } from "./supabaseServer.js";

export async function createMeetEvent({ title, description, startTime, endTime, attendees, creatorUserId }) {
  const auth = await getAuthClient(creatorUserId);
  if (!auth) return null;

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

  const res = await calendar.events.insert({
    calendarId: "primary",
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

async function getAuthClient(userId) {
  // Try OAuth tokens first (industry standard per-user auth)
  if (userId) {
    const db = supabaseAdmin();
    const { data: tokenRow } = await db
      .from("user_google_tokens")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (tokenRow?.refresh_token) {
      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      if (clientId && clientSecret) {
        const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
        oauth2.setCredentials({
          refresh_token: tokenRow.refresh_token,
          access_token: tokenRow.access_token || undefined,
          expiry_date: tokenRow.token_expires_at ? new Date(tokenRow.token_expires_at).getTime() : undefined,
        });

        // Refresh if expired
        try {
          const { credentials } = await oauth2.refreshAccessToken();
          if (credentials.access_token !== tokenRow.access_token) {
            await db.from("user_google_tokens").update({
              access_token: credentials.access_token,
              token_expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
              updated_at: new Date().toISOString(),
            }).eq("user_id", userId);
          }
          oauth2.setCredentials(credentials);
        } catch (_) {}

        return oauth2;
      }
    }
  }

  // Fallback: service account (legacy setup)
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (clientEmail && privateKey) {
    return new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    });
  }

  return null;
}
