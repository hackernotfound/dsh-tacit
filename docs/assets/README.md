# Documentation visuals

`tacit-demo.gif` is an illustrated walkthrough, not a screen recording. Its
example instruction shows installation, correction learning, and the guidance
controls added in 0.7.0. `tacit-install.svg`, `tacit-learn.svg`, and
`tacit-guidance.svg` are the full-size panels.

Regenerate the panels and animation from the repository root on macOS with
Node, `sips`, and FFmpeg installed:

```sh
node scripts/build-demo.mjs
```

The builder reads the version from `package.json`. Run it after a version
change, then inspect every panel before committing the outputs. The animation
holds each panel for six seconds and loops at 960 by 540 pixels.

Run `node scripts/build-demo.mjs --check` on any Node platform to check freshness
without rendering. `tacit-demo.json` records the package version and SHA-256
hashes of the builder, panels, and animation. A changed source, output, or version
fails the check until the assets are regenerated together.

`tacit-settings.png` is a screen capture of the Overview and Usage cards from
a local profile with synthetic runs and directives. The README labels that
data as synthetic. It is separate from the illustrated walkthrough.
