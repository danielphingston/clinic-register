# Deployment

Clinic Register is a static site. You build it once and serve it from any static host over HTTPS; HTTPS is required for the service worker, installation and notifications.

## 1. Google Cloud OAuth client

1. In the Google Cloud Console, create a project.
2. Under **APIs & Services → Library**, enable the **Google Drive API**.
3. Configure the **OAuth consent screen** (Google Auth Platform → Branding, Audience, Data access):
   - User type: **External**, or **Internal** for Google Workspace organisations.
   - Scopes: `openid`, `email`, `profile` and `https://www.googleapis.com/auth/drive.appdata`.
4. Under **Credentials → Create credentials → OAuth client ID**, choose **Web application**:
   - **Authorised JavaScript origins**: add your production origin (for example `https://clinic.example.com`). For development, also add `http://localhost:5173` and `http://localhost:4173`. Origins must match exactly: scheme, host and port, with no path or trailing slash.
   - Leave **redirect URIs** empty. The app uses the Google Identity Services token popup.
5. Set the client ID as `VITE_GOOGLE_CLIENT_ID`.

### Testing vs. production publishing

- **Testing**: only listed test users (up to 100) can sign in, which is enough for a single clinic and its staff. Google's 7-day refresh-token limit doesn't affect the app, because it uses short-lived browser tokens.
- **In production**: any Google account can sign in. Users see an "unverified app" notice until the app's branding is verified.

### Branding verification

None of the requested scopes are sensitive, so only branding verification is needed. There is no security assessment and no demo video.

1. **Branding**: fill in the app name (it must match the home page heading and must not contain "Google"), a 120×120 PNG logo, a support email and a developer contact email.
2. **App domain**: give the home page URL, the privacy policy (`public/privacy.html`) and optionally the terms of service (`public/terms.html`).
3. **Authorised domains**: add the domain the app is served from.
4. **Domain ownership**: verify the domain in [Google Search Console](https://search.google.com/search-console), using the same Google account that owns the Cloud project. On GitHub Pages, verify the root `https://<user>.github.io/` as a *URL prefix* property, using the HTML file or meta tag method in the `<user>.github.io` repository.
5. **Publish and submit**: under **Audience**, publish the app. Then open **Verification Center → Prepare for verification** and submit. Review usually takes a few business days.

## 2. Environment variables

These are build-time variables, which Vite inlines into the bundle. Set them in your host's build settings or in `.env.production.local`, then rebuild.

| Variable | Required | Description |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Yes | OAuth web client ID. It is public and ends up in the JavaScript bundle. |
| `VITE_BASE` | Only for sub-path hosting | The base path, with leading and trailing slashes, e.g. `/clinic-register/`. Defaults to `/`. |
| `VITE_DRIVE_API_BASE`, `VITE_DRIVE_UPLOAD_BASE` | **Never in production** | Development only: point sync at the mock Drive server. See [Development](development.md). |

## 3a. GitHub Pages

`.github/workflows/deploy.yml` runs lint, tests and the build on every push to `master`, then publishes to `https://<user>.github.io/<repo>/`.

One-time setup:

1. **Settings → Pages → Build and deployment → Source**: select **GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables**: add `VITE_GOOGLE_CLIENT_ID`. Use a variable, not a secret, because the client ID is public.
3. Add `https://<user>.github.io` to the OAuth client's authorised JavaScript origins. Give the origin only, without the repository path.
4. Push to `master`, or run the workflow manually from the Actions tab.

The workflow builds with `VITE_BASE=/<repo>/` and copies `index.html` to `404.html`, so deep links load on a first visit. GitHub Pages caches responses for about 10 minutes, so the update prompt may take that long to appear after a deploy.

## 3b. Netlify or Cloudflare Pages

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 20 or newer (`NODE_VERSION=20`) |
| Environment | `VITE_GOOGLE_CLIENT_ID=<your client id>` |

Both hosts read `public/_redirects` and `public/_headers`, which are copied into `dist/`:

- `_redirects` provides the single-page-app fallback (`/* /index.html 200`).
- `_headers` disables caching for `sw.js`, `index.html` and the manifest, so new deploys are picked up, and caches the hashed `/assets/*` files for a year.

After deploying, add the site's origin to the OAuth client's authorised JavaScript origins.
