/**
 * Simple self-hosted web proxy (ProxySite-style)
 * -----------------------------------------------
 * - Serves a search-box homepage (public/index.html)
 * - /go?url=<target>      -> redirects into the proxy for a typed URL or search query
 * - /proxy?url=<target>   -> fetches the target server-side and streams it back,
 *                            rewriting links/forms/assets so the user keeps
 *                            browsing entirely through this proxy.
 *
 * Local run:
 *   npm install
 *   npm start
 * Then open http://localhost:3000
 *
 * Vercel deploy:
 *   This file exports the Express `app`. api/index.js wraps it so Vercel
 *   can run it as a serverless function. See vercel.json for routing.
 */

const express = require("express");
const axios = require("axios");
const https = require("https");
const cheerio = require("cheerio");
const { URL } = require("url");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Some networks/antivirus tools intercept HTTPS with their own certificate
// (SSL inspection), which makes Node reject it as "self-signed certificate
// in certificate chain". This agent skips certificate verification for the
// proxy's outgoing requests so those setups still work. This only affects
// requests this proxy makes on your behalf, not your browser's own
// connections, but it does mean those requests are not certificate-verified.
const insecureHttpsAgent = new https.Agent({ rejectUnauthorized: false });

// Attributes on HTML elements that contain a URL we need to rewrite.
const URL_ATTRS = ["href", "src", "action", "data-src", "poster"];

// Tags whose text content is CSS and may contain url(...) references.
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

function toProxyUrl(base, target) {
  try {
    const abs = new URL(target, base).toString();
    return "/proxy?url=" + encodeURIComponent(abs);
  } catch {
    return target; // leave untouched if it isn't a real URL (mailto:, javascript:, #anchor, etc.)
  }
}

function shouldSkip(target) {
  if (!target) return true;
  return /^(javascript:|mailto:|tel:|data:|#)/i.test(target.trim());
}

function rewriteHtml(html, baseUrl) {
  const $ = cheerio.load(html);

  URL_ATTRS.forEach((attr) => {
    $(`[${attr}]`).each((_, el) => {
      const val = $(el).attr(attr);
      if (shouldSkip(val)) return;
      $(el).attr(attr, toProxyUrl(baseUrl, val));
    });
  });

  // Rewrite inline <style> and style="" url(...) references
  $("style").each((_, el) => {
    const css = $(el).html();
    if (css) {
      $(el).html(
        css.replace(CSS_URL_RE, (m, quote, url) => {
          if (shouldSkip(url)) return m;
          return `url(${quote}${toProxyUrl(baseUrl, url)}${quote})`;
        })
      );
    }
  });
  $("[style]").each((_, el) => {
    const style = $(el).attr("style");
    if (style) {
      $(el).attr(
        "style",
        style.replace(CSS_URL_RE, (m, quote, url) => {
          if (shouldSkip(url)) return m;
          return `url(${quote}${toProxyUrl(baseUrl, url)}${quote})`;
        })
      );
    }
  });

  // Make forms submit back through the proxy (GET/POST -> /proxy?url=action)
  $("form").each((_, el) => {
    const action = $(el).attr("action") || baseUrl;
    $(el).attr("action", toProxyUrl(baseUrl, action));
  });

  // Neutralize target=_blank new-tab links so they still route through the proxy
  $("a[target]").removeAttr("target");

  // Inject a small banner so users always know they're inside the proxy
  const banner = `
    <div id="__proxy_banner" style="position:sticky;top:0;z-index:2147483647;background:#111;color:#fff;
      font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;padding:6px 12px;display:flex;gap:10px;align-items:center;">
      <a href="/" style="color:#7dd3fc;text-decoration:none;font-weight:600;">⬅ Proxy Home</a>
      <span style="opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${baseUrl}</span>
    </div>`;
  $("body").prepend(banner);

  return $.html();
}

function rewriteCss(css, baseUrl) {
  return css.replace(CSS_URL_RE, (m, quote, url) => {
    if (shouldSkip(url)) return m;
    return `url(${quote}${toProxyUrl(baseUrl, url)}${quote})`;
  });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Turn the homepage search box / address bar into a proxied request.
app.get("/go", (req, res) => {
  let input = (req.query.q || "").trim();
  if (!input) return res.redirect("/");

  let target;
  const looksLikeUrl = /^https?:\/\//i.test(input) || /^[\w-]+\.[a-z]{2,}(\/.*)?$/i.test(input);

  if (looksLikeUrl) {
    target = /^https?:\/\//i.test(input) ? input : "https://" + input;
  } else {
    // Treat it as a search query
    target = "https://www.google.com/search?q=" + encodeURIComponent(input);
  }

  res.redirect("/proxy?url=" + encodeURIComponent(target));
});

app.all("/proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing url parameter.");

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return res.status(400).send("Invalid URL.");
  }
  if (!/^https?:$/.test(targetUrl.protocol)) {
    return res.status(400).send("Only http/https URLs are supported.");
  }

  try {
    const method = req.method.toLowerCase();
    const axiosResp = await axios({
      url: targetUrl.toString(),
      method,
      data: method === "post" ? req.body : undefined,
      responseType: "arraybuffer",
      maxRedirects: 5,
      httpsAgent: insecureHttpsAgent,
      headers: {
        "User-Agent":
          req.headers["user-agent"] ||
          "Mozilla/5.0 (compatible; SimpleWebProxy/1.0)",
        Accept: req.headers["accept"] || "*/*",
        "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
      },
      validateStatus: () => true,
    });

    const contentType = axiosResp.headers["content-type"] || "";
    res.status(axiosResp.status);

    if (contentType.includes("text/html")) {
      const html = Buffer.from(axiosResp.data).toString("utf-8");
      const rewritten = rewriteHtml(html, targetUrl.toString());
      res.set("Content-Type", "text/html; charset=utf-8");
      return res.send(rewritten);
    }

    if (contentType.includes("text/css")) {
      const css = Buffer.from(axiosResp.data).toString("utf-8");
      const rewritten = rewriteCss(css, targetUrl.toString());
      res.set("Content-Type", "text/css; charset=utf-8");
      return res.send(rewritten);
    }

    // Everything else (images, fonts, JS, JSON, etc.) is streamed back as-is.
    if (contentType) res.set("Content-Type", contentType);
    return res.send(Buffer.from(axiosResp.data));
  } catch (err) {
    console.error("Proxy error for", target, err.message);
    res.status(502).send(`Could not load that page: ${err.message}`);
  }
});

// Only start a listening server when run directly (local dev).
// On Vercel, the app is imported by api/index.js and wrapped as a
// serverless function instead — Vercel manages the HTTP listener itself.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Web proxy running at http://localhost:${PORT}`);
  });
}

module.exports = app;
