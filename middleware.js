/* Vercel Edge Middleware — gates the whole catalog behind a login.
   Any request without a valid session cookie is redirected to /login.html.
   The login page, the auth API and the favicon are the only public paths. */
import { next } from "@vercel/edge";
import { verifyToken, getSecret } from "./auth/token.mjs";

export const config = {
  matcher: ["/((?!api/login|api/logout|login\\.html|favicon\\.svg|robots\\.txt).*)"]
};

export default async function middleware(request) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)nhl_auth=([^;]+)/);
  const token = m ? decodeURIComponent(m[1]) : "";
  const claims = token ? await verifyToken(token, getSecret()) : null;
  if (claims) return next();

  const url = new URL(request.url);
  const login = new URL("/login.html", request.url);
  login.searchParams.set("next", url.pathname + url.search);
  return Response.redirect(login, 302);
}
