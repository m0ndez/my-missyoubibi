# Contributing

Thanks for helping. The most useful contribution is a **model report**: does your unit work, and what doesn't? Use the
"Model report" issue form.

## Set up

```bash
git clone https://github.com/m0ndez/my-missyoubibi && cd my-missyoubibi
npm ci
npm run setup -- --backend    # broker + bridge in Docker (needs Docker or Podman; finds your adapters)
npm run dev                   # the web app on http://localhost:3000
```

No hardware? `npm run sim` is a dev broker with fake units, and `npm run fake -- <12-digit MAC>` is a fake adapter. (`SIM_PORT=18830 npm run sim` if a real broker already holds port 1883.)

## Before you open a pull request

```bash
npm run typecheck && npm run lint && npm run check
npm run build && npm run e2e   # the end-to-end smoke test (broker, bridge, fake adapter, built app)
```

CI runs the same, plus Docker builds for amd64 and arm64 (each on a native runner).

- This repository uses a newer Next.js than most documentation describes: `AGENTS.md` points to the bundled docs in
  `node_modules/next/dist/docs/`.
- Protocol findings belong in `docs/firmware.md` with how you observed them. Mark anything not verified on a real unit as such.
- Keep the self-checks (`lib/*.ts` run by `npm run check`) throwing on failure and add one for new logic.
- Never test writes on a unit you can't switch back by hand. The adapter locks other clients for 60 seconds after a write.
- Comments say why, not what. Match the surrounding code.

## Releasing (maintainers)

1. In `CHANGELOG.md`, rename `[Unreleased]` to the new version with the date, and add a fresh empty `[Unreleased]` above it.
2. Set the same version in `package.json`.
3. Commit, then tag it `vX.Y.Z` and push the tag. The release workflow checks the tag against `package.json`, runs the tests, builds and
   pushes `ghcr.io/m0ndez/my-missyoubibi-app` and `-bridge` for amd64 and arm64, and creates the GitHub release from the changelog
   section. Each platform is built on a native runner (`ubuntu-24.04`, `ubuntu-24.04-arm`) and pushed by digest; a merge job then
   creates the multi-platform tags with `docker buildx imagetools` and checks that both platforms are in it. Actions and base images
   are pinned by SHA/digest; Dependabot opens weekly pull requests to bump them. A tag with a dash (`v0.2.0-rc1`) is a prerelease and doesn't move `latest`.
4. First release only: make the two packages public (repository → Packages → Package settings), or `docker compose pull` fails with `denied`.

## Reporting a model

Say: model names (indoor unit and adapter), what worked, what didn't, and the adapter's firmware if you know it. Don't paste
passwords or your Wi-Fi key; the MAC address is fine to share.
