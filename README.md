# Poststash

Currently supports saving media from Instagram profiles.

A lightweight Manifest V3 Chrome extension for saving media available on the current Instagram page.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Reload the extension, then refresh Instagram once so it can capture profile media responses.

## Use

- Click **Download all media** beside the account name or in the extension popup. In the popup, choose Posts, Reels, Stories, and/or Highlights, plus a latest-post limit, format, or date range. Stories and Highlights are opt-in. Files go to `Downloads/Instagram/<username>/`.
- Open a post or Reel and use the download icon beside Instagram's action buttons to save that item, including its full carousel. In a Story or Highlight, the download icon appears inside the current frame below its upper controls. Every slide gets a fresh button. A click saves the slide displayed at that moment, even if you advance while the file downloads.
- Pagination and download progress appear directly on the Download button. Download starts are paced to keep Chrome responsive, and any start failures are shown there.

Single Story, Highlight, post, and Reel downloads read the media already loaded by Instagram's viewer. The extension resolves the current player in the page's JavaScript context, using media from the signed-in session's responses or player props, then fetches the full source file. It verifies file contents before saving and reports success only after Chrome finishes saving. Private media requires that your signed-in account can view it. Playback does not need to finish. Carousel downloads include all slides when their media is available in the session.

Bulk profile downloads use Instagram's web endpoints in the browser session. No media or account data is sent to a third-party downloader. Reload the extension and refresh Instagram after updating so the session capture is active.

## Development checks

Run `npm test` for the session resolver and file validation checks. For Chromium extension checks, install development dependencies with `npm install`, install the browser with `npx playwright install chromium`, then run `npm run test:browser`. The browser checks use a separate temporary profile, synthetic Instagram responses, a local HTTPS media server, and a public CC0 video fixture. They require OpenSSL (Git for Windows includes it). Set `POSTSTASH_OPENSSL` if it is installed elsewhere. These fixtures verify the extension's browser behavior; they do not verify access to a live private Instagram account.
