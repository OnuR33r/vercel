# SimpleProxy

A small self-hosted web proxy, similar in spirit to ProxySite.com: type a
search term or a URL, and the server fetches the page on your behalf and
rewrites its links so you keep browsing through the proxy.

## How it works

- `public/index.html` — homepage with a search/address bar.
- `server.js` — Express app (also exported as a module for Vercel):
  - `GET /go?q=...` figures out whether you typed a URL or a search term
    and redirects into the proxy.
  - `GET|POST /proxy?url=<target>` fetches `<target>` server-side (via
    axios), then:
    - If it's HTML, rewrites `href`, `src`, `action`, etc. (using
      Cheerio) so every link/asset/form points back through
      `/proxy?url=...`, and adds a small "Proxy Home" banner.
    - If it's CSS, rewrites any `url(...)` references the same way.
    - Everything else (images, fonts, scripts, JSON, etc.) is streamed
      back unmodified with the original `Content-Type`.
- `api/index.js` — thin wrapper that lets Vercel run `server.js` as a
  serverless function.
- `vercel.json` — routes every request to that function and bundles the
  `public/` folder along with it.

## Run locally

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

## Deploy to Vercel

1. Push this folder to a GitHub repo (or run `vercel` from inside it if
   you have the Vercel CLI installed: `npm i -g vercel`, then `vercel`).
2. On vercel.com, "Add New Project" → import the repo → Deploy. No
   extra configuration needed; `vercel.json` handles routing and static
   files.
3. Vercel gives you a `https://<project>.vercel.app` URL.

**Note:** Vercel's serverless functions have a request timeout (10s on
the free Hobby plan), so very slow target pages may time out. There is
also no built-in websocket/streaming support, so pages that rely on
persistent connections won't work through the proxy.

## Notes & limitations

- This is a demo/starter implementation, not a hardened product. Sites
  with strict Content-Security-Policy headers, heavy client-side
  JavaScript routing, or bot protection (e.g. Cloudflare challenges,
  login-gated content) may not work perfectly — proxying the modern web
  reliably is a large, ongoing engineering effort.
- There's no caching, rate-limiting, HTTPS termination, or abuse
  protection here — add those (and authentication, if needed) before
  exposing this publicly.
- **Use responsibly.** Only proxy sites you're actually permitted to
  access, and don't use this to circumvent network rules you're bound
  by (school, workplace, etc.) or to access illegal content. You're
  responsible for how you deploy and use this code.
