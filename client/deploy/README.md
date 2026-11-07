# Static-host configuration examples

The Frontend build (`client/dist`) is plain static files. The host must rewrite unknown paths
to `index.html` so client routes such as `/projects/<slug>` and `/admin` load, and should send
the security headers and Content-Security-Policy below. All files use the same values.

| File | Host | How it is used |
|---|---|---|
| `client/public/_redirects` | Netlify | SPA fallback `/* /index.html 200`. Vite copies it into `dist/`, where Netlify reads it. |
| `client/public/_headers` | Netlify, Cloudflare Pages | Security headers and CSP. Copied into `dist/`. The comments explain each CSP directive. |
| `client/deploy/vercel.json` | Vercel | Copy it to the Vercel project's Root Directory (`client/vercel.json` when the Root Directory is `client`). |
| `client/deploy/nginx.conf` | nginx | Example `server` block. Also sends HSTS, because nginx terminates TLS itself. |

The Vercel and nginx files are kept out of `client/public/` because those hosts read their
configuration from the project or the server, not from the published files.

Before deploying, replace the placeholder `https://api.example.com` in `connect-src` with the
origin of your API_Server: the scheme and host (and port, if any) of `VITE_API_BASE_URL`,
without the `/api` path. With the placeholder left in, the browser blocks every API request.
