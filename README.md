<p align="center">
  <img src="assets/icons/poststash-256.png" alt="Poststash icon" width="88">
</p>

<h1 align="center">Poststash</h1>

<p align="center">Save Instagram media without leaving the page.</p>

<p align="center">
  <a href="https://github.com/lurantys/poststash/archive/refs/heads/main.zip"><strong>Download ZIP</strong></a>
  &nbsp;·&nbsp;
  <a href="#install">Install</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/lurantys/poststash/issues">Report a bug</a>
</p>

<p align="center">
  <img alt="Chrome 116 or newer" src="https://img.shields.io/badge/Chrome-116%2B-5368ff?style=flat-square">
  <img alt="Version 1.5.1" src="https://img.shields.io/badge/version-1.5.1-17152b?style=flat-square">
</p>

<p align="center">
  <img src="docs/images/instagram-post.png" alt="Real Instagram post page with Poststash's download icon beside Share" width="900">
  <br><sub>The download icon sits beside Share, in Instagram's own action row.</sub>
</p>

| Individual downloads | Profile downloads | Your filters |
| --- | --- | --- |
| Photos, videos, full carousels, Reels, Stories, and Highlights. | Save a profile's media with **Download all media**. | Choose content types, photos or videos, dates, and a post limit. |

## Install

1. **[Download the ZIP](https://github.com/lurantys/poststash/archive/refs/heads/main.zip)** and unzip it.
2. Open **`chrome://extensions`** in Chrome and turn on **Developer mode**.
3. Click **Load unpacked** and select the **`poststash-main`** folder.
4. Refresh your Instagram tabs. Pin Poststash to the toolbar for easy access.

**Chrome 116+ · No build step · Uses your signed-in Instagram session**

## Use it

**One post or Reel:** click the download icon beside Share. For carousels, it saves every photo and video.

**A Story or Highlight:** click the download icon in the current Story frame.

**An entire profile:** open the profile and click **Download all media** beside its name. Open the extension popup to choose filters; **Latest posts = `0`** means all posts.

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

Files are saved to **`Instagram/<username>/<content type>/`** inside your browser's download folder.

<details>
<summary><strong>Something not working?</strong></summary>

- **Missing button:** reload Poststash in `chrome://extensions`, then refresh Instagram.
- **Failed download:** check that the media opens while you're signed in, then retry.
- **Still stuck:** [open an issue](https://github.com/lurantys/poststash/issues) with the page type and a screenshot.

</details>
