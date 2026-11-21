# GrabIt for iPhone

Save videos, reels, photos and audio from Instagram, TikTok, YouTube, Facebook and X straight to your iPhone's Photos, and convert videos on the phone. Built with Expo SDK 58 and iOS 26's Liquid Glass design.

## What it does

- **Download:** paste a link, or tap **Share › GrabIt** inside Instagram, TikTok, YouTube and other apps. Choose **Save video** or **Save audio only**. Videos and photos go straight to Photos. Instagram carousels and TikTok photo posts save every picture.
- **Convert:** pick a video from Photos or Files. Make it smaller (1080p/720p/480p), take the sound out as audio, trim it, remove the sound, or turn it into a GIF. Everything happens on the phone; nothing is uploaded.
- **Library:** everything you saved, with playback, Share, Save to Photos, Convert and Delete. Files also show up in the **Files** app under **On My iPhone › GrabIt**.

Links are read and downloaded on the iPhone itself, so sites see a normal phone connection. Other websites (SoundCloud, Dailymotion...) go through the GrabIt server on Vercel as a fallback.

## Install it on your iPhones (one-time setup)

You need: your Apple Developer account, a free [Expo account](https://expo.dev/signup), and a Mac or Windows PC with [Node.js](https://nodejs.org) 20 or later. Expo builds the app in the cloud, so no Xcode is needed.

**1. Get the code and install its packages**

```bash
git clone https://github.com/eyadmaherrr/grabit.git
```

```bash
cd grabit/mobile
```

```bash
npm install
```

**2. Sign in to Expo**

```bash
npx eas-cli@latest login
```

**3. Register both iPhones.** Apple only lets this kind of app run on phones it knows about.

```bash
npx eas-cli@latest device:create
```

Choose **Website**. Open the link it prints (or scan the QR code) on **your iPhone** in Safari, tap **Allow**, then go to **Settings › Profile Downloaded › Install**. Run the command again for **your dad's iPhone**.

**4. Build the app** (about 15–20 minutes, in Expo's cloud)

```bash
npx eas-cli@latest build --platform ios --profile phone
```

When asked, sign in with your Apple Developer account and answer **Yes** to letting Expo create the certificate and provisioning profile. Select both iPhones when it lists devices.

**5. Install on each iPhone.** When the build finishes, open the link it prints (or scan its QR code) on each iPhone and tap **Install**. The link is also on [expo.dev](https://expo.dev) under the project's Builds.

**6. Turn on Developer Mode on each iPhone.** iOS requires this for apps installed this way: **Settings › Privacy & Security › Developer Mode › On**, then restart and confirm.

**7. Add GrabIt to the Share menu (optional, recommended).** In Instagram or TikTok, tap **Share**, scroll the row of apps to the end, tap **More**, and turn on **GrabIt**. From then on, Share › GrabIt opens the app with the link already filled in.

### Updating later

After pulling new code, run step 4 again and reinstall from the new link. To add another iPhone, run step 3 for it, then step 4.

### If the bundle ID is taken

`com.eyadmaher.grabit` in `app.json` must be unique in your Apple account. If Expo reports it's in use, change `ios.bundleIdentifier` to something else, e.g. `com.yourname.grabit`.

## How it's built

| Part | What it is |
|------|------------|
| `src/app/` | Screens (Expo Router): Download, Convert, Library, and the item sheet. Native iOS 26 tab bar. |
| `src/ui/` | Liquid Glass cards (`expo-glass-effect`), native SwiftUI glass buttons (`@expo/ui`), colours. |
| `src/lib/sites/` | One reader per site. YouTube uses [youtubei.js](https://github.com/LuanRT/YouTube.js). |
| `src/lib/save.ts` | Download → (merge or extract audio) → Photos → Library. |
| `modules/media-tools/` | A small Swift module on Apple's AVFoundation: joins YouTube's separate HD video and sound, converts to MP4/M4A/GIF, trims, resizes, makes thumbnails. |

Checks: `npx tsc --noEmit`, `npx expo lint`, and `npx expo export --platform ios` (bundles and compiles everything for the iPhone's JavaScript engine).

## Good to know

- Only download content you own or have permission to save.
- Private accounts, stories and age-restricted YouTube videos need signing in, which GrabIt doesn't do. It says so plainly when that's the case.
- Sites change their pages from time to time. If one stops working, the fix is usually a small change in `src/lib/sites/`.
