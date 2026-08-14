/* GET /api/photo?n=<partNumber>&f=<file> — server-side proxy for Cummins part
   photos. The browser fetches photos from our own origin (works even when the
   client network can't reach parts.cummins.com directly); Vercel fetches the
   image from the public Cummins CDN and streams it back, cached at the edge.
   Only parts.cummins.com/graphics/parts/<n[0:3]>/<n>/<file> is reachable, and
   the file must begin with the numeric part number (no SSRF / traversal). */
export const config = { runtime: "edge" };

export default async function handler(request) {
  const url = new URL(request.url);
  const n = (url.searchParams.get("n") || "").trim();
  const f = (url.searchParams.get("f") || "").trim();
  if (!/^\d{2,12}$/.test(n) || !/^[A-Za-z0-9._-]+\.(png|jpe?g|gif)$/.test(f) || f.indexOf(n) !== 0) {
    return new Response("bad request", { status: 400 });
  }
  const src = "https://parts.cummins.com/graphics/parts/" + n.slice(0, 3) + "/" + n + "/" + f;
  let up;
  try {
    up = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "image/*,*/*" } });
  } catch (e) {
    return new Response("upstream error", { status: 502, headers: { "cache-control": "no-store" } });
  }
  if (!up.ok) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=86400" } });
  return new Response(up.body, {
    status: 200,
    headers: {
      "content-type": up.headers.get("content-type") || "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable"
    }
  });
}
