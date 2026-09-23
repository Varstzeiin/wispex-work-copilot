import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast redirect to /login when there is no session cookie at all.
 * The real authentication check always happens on the backend for every API call.
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has("wispex_session");
  const { pathname } = request.nextUrl;
  if (!hasSession && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip API proxy, static files, PWA assets
  matcher: ["/((?!api|_next/static|_next/image|icons|sw.js|offline.html|manifest.webmanifest|icon.png|favicon.ico).*)"],
};
