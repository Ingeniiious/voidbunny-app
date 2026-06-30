# voidbunny.xyz

Marketing site for [Voidbunny](https://github.com/Ingeniiious/voidbunny-app) — the install-and-forget app that puts Claude Code, Codex, and Gemini CLIs on your phone, running on an Ubuntu box you rent.

Built on a Next.js 16 + Tailwind v4 + motion + OGL (WebGL dither) template from React Bits Pro.

## Local dev

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm run format` | Prettier write |

## Project layout

- `app/page.tsx` — single-page landing
- `app/layout.tsx` — root layout with theme + smooth-scroll providers
- `app/globals.css` — design tokens (brand orange = `--brand` / `--brand-soft`)
- `components/*` — section components (header, hero parts, showcase, community, faq, final-cta, footer)
- `components/dither-shader.tsx` — WebGL dither (OGL); accepts `tone={{r,g,b}}` for the brand-orange tint
- `lib/metadata.ts` — SEO metadata (site name, URL, OG)
- `public/install.sh` — served at `voidbunny.xyz/install.sh` for the curl-pipe-bash install line

## Brand

The brand orange is `#c2410c` in light mode and `#ea580c` in dark mode (see `app/globals.css`). It's applied to the focus ring and tints the dither shader on the hero, community backdrop, and final CTA. The actual panel app uses the same orange — keep them in sync if you tweak.

## Deploying

Production should run on the Hetzner box behind Caddy. Build with `npm run build`, run `npm run start -- -p 3000`, and reverse-proxy `voidbunny.xyz` plus `www.voidbunny.xyz` to that local port.

## License

MIT.
