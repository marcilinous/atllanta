import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export default async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Build and local dev must still work without Supabase configured, exactly
  // like isSupabaseConfigured() elsewhere — pass the request through instead
  // of throwing.
  if (!url || !key) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  // The documented @supabase/ssr session-refresh shape: cookies must be copied
  // onto both the request (so this client sees them immediately) and a new
  // response (so the browser does) or a refreshed token never reaches
  // the caller.
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Nothing else runs between client creation and this call — that gap is
  // where a refreshed session gets silently dropped.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // v1.14.0: atllanta.com — the public home page for visitors, the app for
  // anyone signed in. A Google sign-in returns to "/?code=…" before the
  // session exists; that must reach the app, which finishes the sign-in.
  if (request.nextUrl.pathname === "/" && !user && !request.nextUrl.searchParams.has("code")) {
    const url = request.nextUrl.clone();
    url.pathname = "/home.html";
    const home = NextResponse.rewrite(url, { request });
    for (const cookie of response.cookies.getAll()) home.cookies.set(cookie);
    return home;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|otf|mp4|webm)$|js/|css/|.*\\.html$).*)",
  ],
};
