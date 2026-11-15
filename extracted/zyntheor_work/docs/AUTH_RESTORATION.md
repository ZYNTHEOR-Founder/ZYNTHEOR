# ZYNTHEOR Authentication Architecture & Restoration Guide

## Why Google Authentication Was Temporarily Decoupled in Development

- `firebase-applet-config.json` targets existing Firebase project `valid-foundry-6v8b6` (`authDomain: valid-foundry-6v8b6.firebaseapp.com`).
- Google Identity Toolkit (`getProjectConfig`) confirms Google OAuth is enabled on `valid-foundry-6v8b6`, but its `authorizedDomains` allowlist does not include dynamic AI Studio / Cloud Run preview origins (for example `ais-dev-kdhjljmx4gvdgfmtyw7zy2-962549943978.asia-east1.run.app`, `ais-pre-kdhjljmx4gvdgfmtyw7zy2-962549943978.asia-east1.run.app`, or earlier preview hosts).
- Consequently, `signInWithPopup(auth, googleAuthProvider)` fails with `auth/unauthorized-domain` in the browser unless the active preview hostname is added to Firebase Console → Authentication → Settings → Authorized domains.
- Attempting automated provisioning against `valid-foundry-6v8b6` from this workspace failed with a permission error on the external Cloud project, and replacing the Firebase project is explicitly disallowed.

## How the Isolated Development Access Path Works

- **Preserved Production Path**:
  - `src/lib/firebase.ts`, `src/lib/firebase-admin.ts`, `src/middleware/auth.ts`, `POST /api/auth/firebase-session`, and `"Continue with Google"` remain fully intact.
  - `.env.example` defaults to `ZYNTHEOR_ENABLE_DEV_LOGIN=false`.
- **Server-Side Gate (`server.ts`)**:
  - `GET /api/auth/mode` reports `devAccessEnabled: true` **only** when `NODE_ENV !== 'production'` **and** `ZYNTHEOR_ENABLE_DEV_LOGIN === 'true'`.
  - `POST /api/auth/login` returns `403 DEV_LOGIN_DISABLED` in production (`NODE_ENV=production`) regardless of `ZYNTHEOR_ENABLE_DEV_LOGIN`, and whenever `ZYNTHEOR_ENABLE_DEV_LOGIN !== 'true'`.
  - When enabled in local development (via `npm run dev` script `ZYNTHEOR_ENABLE_DEV_LOGIN=true tsx server.ts` or gitignored `.env`), `POST /api/auth/login` issues a real HS256-signed `ZY-TOKEN` tagged `authMode: 'development'` (`authMethod: 'dev_login'` in `AuditLedger`).
  - All backend `requireAuth(...)`, `requireRole(...)`, `requireFirebaseAuth`, tenant isolation, and `TokenRevocation` checks remain fully active.
- **Client UI (`src/context/AuthContext.tsx`, `src/App.tsx`)**:
  - No automatic privileged login occurs.
  - When `devAccessEnabled` is `true`, an explicit **"Development Access Only"** panel appears below **"Continue with Google"**, letting the developer choose a role (`User`, `Developer`, `Administrator`) and explicitly start a development session.
  - When authenticated in development mode, the Sidebar and User Settings display a `DEV` / `Development Access (Non-Production)` indicator, and `Sign out` revokes the token via `POST /api/auth/logout`.

## How to Restore Normal Google Authentication

1. Open the **Firebase Console** for project **`valid-foundry-6v8b6`**.
2. Navigate to **Authentication → Settings → Authorized domains**.
3. Add the active deployment/preview hostnames:
   - `ais-dev-kdhjljmx4gvdgfmtyw7zy2-962549943978.asia-east1.run.app`
   - `ais-pre-kdhjljmx4gvdgfmtyw7zy2-962549943978.asia-east1.run.app`
4. Disable the temporary development bypass:
   - Restore `"dev": "tsx server.ts"` in `package.json`.
   - Ensure `ZYNTHEOR_ENABLE_DEV_LOGIN=false` in `.env` (or unset it) and run with `NODE_ENV=production` for production deployments (`npm run start`).
5. Verify on the login screen that:
   - Only **"Continue with Google"** is displayed (the Development Access box disappears).
   - Clicking **"Continue with Google"** completes Firebase OAuth popup sign-in, exchanges the Firebase ID token at `POST /api/auth/firebase-session`, persists the session across page reload, and signs out cleanly via `Sign out`.
