<p align="center">
  <img src="assets/icons/poststash-256.png" alt="Poststash icon" width="88">
</p>

<h1 align="center">Poststash</h1>

<p align="center">A multi-platform media downloader for Instagram, TikTok, X, and YouTube.</p>

<p align="center">
  <a href="https://github.com/lurantys/poststash/archive/refs/heads/main.zip"><strong>Download ZIP</strong></a>
  &nbsp;·&nbsp;
  <a href="#install">Install</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/lurantys/poststash/issues">Report a bug</a>
</p>

<p align="center">
  <img alt="Chrome 116 or newer" src="https://img.shields.io/badge/Chrome-116%2B-5368ff?style=flat-square">
  <img alt="Version 1.6.0" src="https://img.shields.io/badge/version-1.6.0-17152b?style=flat-square">
</p>

<p align="center">
  <img src="docs/images/instagram-post.png" alt="Real Instagram post page with Poststash's download icon beside Share" width="900">
  <br><sub>The download icon sits beside Share, in Instagram's own action row.</sub>
</p>

| Instagram | TikTok | X | YouTube | Your filters |
| --- | --- | --- | --- | --- |
| Posts, carousels, Reels, Stories, Highlights, and profile downloads. | The current video or photo slideshow in the feed or fullscreen viewer. | Photos and videos from an individual post. | Audio from individual videos and Shorts, saved with the video title. | Content types, format, dates, and post limits for Instagram profiles. |

## Install

1. **[Download the ZIP](https://github.com/lurantys/poststash/archive/refs/heads/main.zip)** and unzip it.
2. Open **`chrome://extensions`** in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and select the **`poststash-main`** folder.
4. Refresh your Instagram, TikTok, X, and YouTube tabs. Pin Poststash to the toolbar for easy access.

**Chrome 116+ · No build step · Uses your browser session**

## Use it

### Instagram

**One post or Reel:** click the download icon beside Share. For carousels, it saves every photo and video.

**A Story or Highlight:** click the download icon in the current Story frame.

**An entire Instagram profile:** open the profile and click **Download all media** beside its name. Open the extension popup to choose filters; **Latest posts = `0`** means all posts.

<table>
  <tr>
    <td align="center"><strong>In the Instagram feed</strong></td>
    <td align="center"><strong>Choose what to save</strong></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/instagram-feed.png" alt="Real Instagram feed card with the download icon in its action row" width="420"></td>
    <td align="center"><img src="docs/images/popup.png" alt="Poststash popup with content, format, date, and post-limit filters" width="320"></td>
  </tr>
</table>

### TikTok

Open `tiktok.com` and click the **download icon** for the video on screen:

- **Main feed:** below Share in the interaction column.
- **Fullscreen viewer:** beside Favorite in the interaction row.

<p align="center">
  <img src="docs/images/tiktok-viewer.png" alt="Real TikTok video feed with Poststash’s download icon in the action column" width="900">
  <br><sub>Download from the TikTok feed using the native action column.</sub>
</p>

TikTok support covers **individual videos and photo slideshows** (each photo saved separately). Profile downloads are not supported yet.

### X

Open `x.com` and click the **download icon** in the action row of a post with photos or video. Poststash saves each media item from that post separately. X support is limited to individual posts; profiles and batches are not supported.

The button is also available beside Share in the media viewer. It shows a spinner while saving and a checkmark after a successful download.

<p align="center">
  <img src="docs/images/x-post.png" alt="X post with Poststash's download icon beside Share in the action row" width="600">
  <br><sub>Save media from an X post using the download icon beside Share.</sub>
</p>

### YouTube

Open a video and click **Save audio** beside Share, below the video. On Shorts, click **Audio** in the current Short's action column.

- Audio saves as **M4A** when available, with **WebM** as a fallback.
- The filename uses the **video title**, preserving spaces and Unicode. Characters that filenames cannot contain are replaced, and very long titles are shortened.
- Downloads work while the video is **paused**. The button shows **Saving…** while the file is prepared.
- Status messages fade in and out and disappear within **two seconds**.

<p align="center">
  <img src="docs/images/youtube-audio.png" alt="YouTube video with Poststash's Save audio button beside Share, matching YouTube's download icon" width="900">
  <br><sub>Save a video's audio directly from YouTube's action row.</sub>
</p>

Live broadcasts are not supported. If YouTube refuses access or a download fails, the button shows an error and lets you retry.

### Download locations

Files are saved inside your browser's download folder:

- Instagram: **`Instagram/<username>/<content type>/`**
- TikTok videos: **`TikTok/<username>/videos/`**
- TikTok photos: **`TikTok/<username>/photos/`**
- X: **`X/`**
- YouTube audio: **`YouTube/<channel>/audio/`**

<details>
<summary><strong>Something not working?</strong></summary>

- **Missing button:** reload Poststash in `chrome://extensions`, then refresh Instagram, TikTok, X, or YouTube.
- **Failed download:** check that the media opens while you're signed in, then retry.
- **Still stuck:** [open an issue](https://github.com/lurantys/poststash/issues) with the page type and a screenshot.

</details>
