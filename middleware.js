/* Vercel Edge Middleware — gates the whole catalog behind a login.
   Dependency-free: to continue a request it returns the `x-middleware-next`
   response (what @vercel/edge's next() emits); otherwise it redirects to
   /login.html. The login page, the auth API and the favicon stay public. */
import { verifyToken, getSecret } from "./auth/token.mjs";
/* Переключатель открытого доступа. true — каталог пускает всех без входа
   (временный режим), false — вход обязателен. Менять только осознанно:
   при true по ссылке доступны и документация, и остатки, и цены, и заказы. */
const PUBLIC_ACCESS = true;


export const config = {
  matcher: ["/((?!api/login|api/logout|api/photo|login\\.html|favicon\\.svg|robots\\.txt).*)"]
};

function cont() {
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}

export default async function middleware(request) {
  if (PUBLIC_ACCESS) return cont();

  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)nhl_auth=([^;]+)/);
  const token = m ? decodeURIComponent(m[1]) : "";
  let claims = null;
  if (token) {
    try { claims = await verifyToken(token, getSecret()); }
    catch (e) { claims = null; } // AUTH_SECRET missing -> fail closed, fall through to login
  }
  if (claims) return cont();

  const url = new URL(request.url);
  const login = new URL("/login.html", request.url);
  login.searchParams.set("next", url.pathname + url.search);
  return Response.redirect(login, 302);
}
