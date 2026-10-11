import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { DEV_SITE_COOKIE, internalPath, isPublicPath, publicUrl, siteFromHost } from "@/lib/host";
import { hostOnly } from "@/lib/cookies";
import { supabaseEnv } from "@/lib/supabase/env";

// Routes every request by Host (EN1) and refreshes the Supabase session. Authorisation is not decided here:
// the (app) layouts check the user, staff row and aal2, and RLS enforces it again in the database.
export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const dev = process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV === "preview";
  const override = searchParams.get("host");
  const site = siteFromHost(request.headers.get("host"), {
    dev,
    override,
    remembered: request.cookies.get(DEV_SITE_COOKIE)?.value,
  });
  if (!site) return new NextResponse("Not found", { status: 404 });

  const target = request.nextUrl.clone();
  target.pathname = internalPath(site, pathname);
  const secure = request.nextUrl.protocol === "https:";

  let response = NextResponse.rewrite(target, { request: { headers: request.headers } });
  const { url, key } = supabaseEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet, headers) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.rewrite(target, { request: { headers: request.headers } });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, hostOnly(options, secure)));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Validates the JWT (and refreshes it when expired). Do not put code between client creation and this call.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && !isPublicPath(pathname, site)) {
    const login = publicUrl("/login", {
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      forwardedProto: request.headers.get("x-forwarded-proto"),
    }, request.nextUrl.protocol);
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    response = redirect;
  }

  if (dev && (override === "client" || override === "admin")) {
    response.cookies.set(DEV_SITE_COOKIE, override, { path: "/", sameSite: "lax", httpOnly: true });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
