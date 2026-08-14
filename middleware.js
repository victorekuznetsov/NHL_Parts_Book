/* Vercel Edge Middleware — gates the whole catalog behind a login.
   Dependency-free: to continue a request it returns the `x-middleware-next`
   response (what @vercel/edge's next() emits); otherwise it redirects to
   /login.html. The login page, the auth API and the favicon stay public. */
import { verifyToken, getSecret } from "./auth/token.mjs";

export const config = {
  matcher: ["/((?!api/login|api/logout|login\\.html|favicon\\.svg|robots\\.txt).*)"]
};

function cont() {
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}

export default async function middleware(request) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)nhl_auth=([^;]+)/);
  const token = m ? decodeURIComponent(m[1]) : "";
  const claims = token ? await verifyToken(token, getSecret()) : null;
  if (claims) return cont();

  const url = new URL(request.url);
  const login = new URL("/login.html", request.url);
  login.searchParams.set("next", url.pathname + url.search);
  return Response.redirect(login, 302);
}
