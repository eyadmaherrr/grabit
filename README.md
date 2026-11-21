# GrabIt

Download videos, reels and audio from YouTube, Instagram, Facebook, TikTok, X and other sites, then convert them between formats in the browser. English and Arabic, built on the Dr. Maher Mahmoud "Obsidian & Blue" design system.

## How it works

| Part        | Where it runs                                  | What it does |
|-------------|------------------------------------------------|--------------|
| `public/`   | Static files on Vercel's CDN                   | The page: HTML, CSS, JavaScript, plus the English/Arabic strings. |
| `api/index.py` | One Vercel Python function (Flask)          | `/api/info` reads a link with [yt-dlp](https://github.com/yt-dlp/yt-dlp). `/api/download` streams the file to the visitor, using ffmpeg to merge video and audio or to make an MP3. Nothing is stored on the server. |
| Converter   | The visitor's browser ([ffmpeg.wasm](https://ffmpegwasm.netlify.app/)) | Converts, trims and resizes files locally. Files are never uploaded, so Vercel's upload size limit doesn't apply. |

Instagram photo posts and carousels without video fall back to [gallery-dl](https://github.com/mikf/gallery-dl).

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New → Project**, import the repository and press **Deploy**. Leave the framework preset as **Other**. `vercel.json` already routes `/api/*` to the Python function and gives it 300 seconds to run.

Or, with the Vercel CLI, from this folder:

```bash
npx vercel --prod
```

### Optional environment variables

Set these in **Project → Settings → Environment Variables**, then redeploy.

| Variable          | What it's for |
|-------------------|---------------|
| `GRABIT_PROXY`    | A proxy URL, e.g. `http://user:pass@host:port`. YouTube often blocks cloud servers with "Sign in to confirm you're not a bot", and Instagram rate-limits them. A residential proxy is the usual fix. |
| `GRABIT_COOKIES`  | The contents of a Netscape `cookies.txt` from a logged-in browser. Lets the server open posts that need sign-in. Use a spare account: cookies give full access to it. |

## What to expect from a cloud deployment

- **YouTube** checks the reputation of the server's IP address. Vercel runs on cloud IPs, so expect YouTube links to fail with the bot check unless `GRABIT_PROXY` is set. The page explains this to visitors when it happens.
- **Instagram and Facebook** often work for public reels and posts. Some posts, and heavy use, need `GRABIT_COOKIES`.
- **TikTok, X, Reddit, Vimeo and SoundCloud** usually work as-is.
- **Time limit:** a download must finish within the function's 300 seconds. Long videos at high quality can hit it, and the page suggests a lower quality when they do. Pro plans can raise `maxDuration` in `vercel.json` (up to 800).
- **Bandwidth:** every download passes through the function and counts towards your Vercel data transfer. For a public portfolio link, consider turning on Vercel's firewall rate limiting for `/api/download`.

## Run it locally

```bash
python3 -m venv .venv
```

```bash
.venv/bin/pip install -r requirements.txt
```

```bash
.venv/bin/python api/index.py
```

Then open http://127.0.0.1:5000. Locally, YouTube and Instagram usually work without a proxy because your home IP isn't blocked.

## Project layout

```
api/index.py          Flask API: /api/info, /api/download, /api/thumb, /api/health
public/index.html     Page markup
public/styles.css     Design-system tokens and components, plus app layout
public/app.js         Download flow, converter, language switching
public/i18n.js        English and Arabic strings
public/icons.js       Lucide icons used by the page
public/vendor/ffmpeg  ffmpeg.wasm 0.12 (self-hosted, so no third-party CDN is needed)
vercel.json           Routing, function duration, caching
```

## Security notes

- The API refuses links that resolve to private or internal addresses, so it can't be used to reach the server's own network.
- `/api/thumb` only relays images from known media CDNs.
- No files, links or logs are kept.

## Credits

[yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense), [gallery-dl](https://github.com/mikf/gallery-dl) (GPL-2.0), [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) (MIT; the ffmpeg core build is GPL), [Lucide](https://lucide.dev) icons (ISC).

Only download content you own or have permission to save.
