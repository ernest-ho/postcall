# PostCall

A standalone self-check tool for the PARA (Professional Association of Resident Physicians of Alberta) Resident Physician Agreement's on-call scheduling rules.

Enter your own shifts and vacation days on the calendar, and check them against the agreement's hard rules (rest minimums, consecutive-shift caps, weekend entitlements, vacation blackout periods, etc.). Everything runs entirely in your browser: nothing you enter is sent anywhere.

## Why a static site with no backend

The rule-checking logic is a pure function of the shifts you enter. It was ported to TypeScript from the [call-scheduler](https://github.com/ernest-ho/call-sheduler) project's Python validator specifically so this tool could run as a static, zero-backend site with no server to trust, rate-limit, or pay for.

The tradeoff: this TS port is a second implementation of the same rules, maintained separately from the Python original. If the source repo's rule logic changes, this repo needs a matching update; see `src/rules/` for the ported files, each with a comment back to its Python source.

## Development

```
bun install
bun run dev      # local dev server
bun run test     # vitest parity tests against known fixtures
bun run build    # production build to dist/
```

## Deployment

Pushes to `main` build and deploy automatically to GitHub Pages via `.github/workflows/deploy.yml`.
