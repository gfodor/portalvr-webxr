# 360 Video Adapter

This note distills how Wolvic (commit `6121cbc4f8c1ce702818bcba0b9f2c8b98cd06af`) makes YouTube stereoscopic and 360° videos behave correctly, and what you would need to replicate the feature in a stand-alone browser extension.

## Existing Wolvic Behavior

### Packaged WebExtension (`app/src/main/assets/extensions/fxr_youtube`)
1. **UA + layout overrides.** `main.js` swaps `navigator.userAgent` for an Oculus Browser UA and injects a strict `meta viewport` so YouTube serves the high-resolution mobile/VR layout before its SPA bootstraps. `overrideUA()` and `overrideViewport()` run as soon as the script loads (lines 23–44).
2. **Quality selection.** After the IFrame API becomes available, `overrideQuality()` asks for the highest preferred rendition (2160p→720p) via `setPlaybackQualityRange()` and retries until it sticks (lines 46–76, 288–308).
3. **Projection heuristics.** Helper methods scan the title and description for keywords (`360`, `stereo`, `SBS`, `top/bottom`). `overrideVideoProjection()` maps the detected pattern to a `mozVideoProjection` query parameter (`3d_auto`, `3dtb_auto`, `360_auto`, `360s_auto`) and rewrites the URL via `history.replaceState()` so Gecko’s VR UI can read it later (lines 78–164, 319–323, 378–383).
4. **Player bootstrap.** The global listeners registered at the bottom of the file ensure every click first re-runs the projection logic, plays the video, enters fullscreen, and retries playback if the element pauses. `yt-navigate-start`/`yt-update-title` hooks trigger the same work when YouTube’s SPA navigates internally (lines 173–403).
5. **UX patches.** Additional helpers remove overlays in fullscreen for stereo/360 videos, fix drag handles in the queue, throttle double clicks, and pad the control strip so it remains reachable in portrait-ish viewports (lines 202–351). `main.css` enforces `width/height:100%` on `.fxr-vr-video` to defeat letterboxing and hides incompatible controls (lines 48–74).

### Native Glue
1. **URL rewrite.** `YoutubeUrlHelper.maybeRewriteYoutubeURL()` appends `app=desktop` to every `/watch` URL (and drops any pre-existing `app` parameter), because YouTube only exposes its VR player variants when that query flag is set. See `app/src/common/chromium/com/igalia/wolvic/browser/api/impl/YoutubeUrlHelper.java` lines 15–44.
2. **Projection consumption.** `VideoProjectionMenuWidget.getAutomaticProjection()` parses `mozVideoProjection` (case-insensitive), translates it to Wolvic’s internal projection enum, and marks whether immersive mode should auto-launch when the suffix `_auto` is present. See `app/src/common/shared/com/igalia/wolvic/ui/widgets/menus/VideoProjectionMenuWidget.java` lines 147–185.

## Building Your Own Extension

1. **Manifest + match patterns.** Target `https://*.youtube.com/*` and `https://*.youtube-nocookie.com/*`. Inject your content script/CSS at `document_start` so UA and viewport overrides beat YouTube’s scripts.
2. **User-Agent control.** Use `Object.defineProperty(navigator, 'userAgent', …)` (Firefox) or the browser’s UA-override API so you are treated like a recent mobile VR browser. Without this, YouTube can fallback to TV/embedded layouts that hide 360° controls.
3. **Layout guardrails.** Inject or modify `<meta name="viewport">` and adopt `.fxr-vr-video`-style CSS that forces stereoscopic videos to fill the canvas in fullscreen or within `.ytp-fullscreen` containers.
4. **Projection inference.** Reuse the Wolvic heuristics: examine title + description, skip obvious “audio” uploads, and set `mozVideoProjection=<mode>`. You can extend the mapping table below as you encounter more naming conventions.

   | Detected pattern | Query value |
   | ---------------- | ----------- |
   | SBS / "side by side" | `3d_auto` |
   | Top/Bottom | `3dtb_auto` |
   | 360 mono | `360_auto` |
   | 360 stereo / “360 3D” | `360s_auto` |

5. **Player API integration.** Wait for `#movie_player` with a `wrappedJSObject` reference (Firefox) or message the iframe via `postMessage` elsewhere. Request the preferred quality list, auto-play, and call `requestFullscreen()` on first interaction. Keep retry logic (`retry(taskName, fn, attempts, interval)`) to survive YouTube’s async initialization.
6. **SPA awareness.** Listen to `yt-navigate-start` / `yt-update-title` / `yt-player-updated` to rerun all adjustments when the SPA swaps videos without a full page load.
7. **Overlay hygiene.** Observe `.videowall-endscreen`, `.ytp-upnext`, etc., and hide them when fullscreen + stereoscopic to keep the two eyes in sync. Likewise, disable context menus on drag handles if the target browser’s controller sends long-press events like a right-click.
8. **URL normalization.** Ensure every `/watch` navigation includes `app=desktop`. In Firefox you can do this from the content script before calling `history.replaceState`, or via a background script using `webRequest` / `declarativeNetRequest` so the flag is present before the document loads.
9. **Host integration.** If your browser understands `mozVideoProjection`, you’re done. Otherwise, consume your own query flag (or store state in `window`) and trigger the equivalent WebXR/stereo pipeline manually, possibly via a companion toolbar UI.
10. **Test matrix.** Validate with representative videos: mono 360°, stereo 360°, SBS 3D, top/bottom 3D, embedded players (`/embed/…`), and SPA transitions (YouTube queue, playlist autoplay, Shorts → Watch). Confirm overlays stay hidden, fullscreen auto-enters, and quality holds the requested level.

These steps reproduce the heart of Wolvic’s YouTube handling without needing the rest of the browser stack, so you can ship stereoscopic fixes as an independent extension.
