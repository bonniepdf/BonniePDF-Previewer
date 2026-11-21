# Changelog

All notable changes to `@bonniepdf/previewer` are documented here. Versions use
CalVer (`yyyy.m.minor`) and match the BonniePDF release they ship with. A
release is published by pushing a `v<version>` tag (see
`.github/workflows/release.yml`).

## Unreleased

## 2026.11.21

Status: Released
Date: 2026-11-21

First public release.

- `<bonnie-pdf-previewer>` web component and `createPreviewer()` factory: a paginated, zoomable viewer for BonniePDF's SVG pages, with thumbnails, page navigation, fullscreen and a lazy Download PDF button, isolated from host-page CSS in a Shadow DOM.
- `load()` accepts a `@bonniepdf/core` `Document`, an SVG document export (including JSON from a .NET server or a web worker), or a promise of either.
- `complianceView()` accessibility inspector: the tagged structure tree, PDF/UA-1 findings, optional WCAG contrast checks, and two-way selection between the tree and the page.
- Theming through `--bpdf-*` and CongruentUI `--cui-*` custom properties, an optional footer with conformance pills, and `preference-key` to remember panel and zoom choices.
- Show PDF/A-4, PDF/A-4f and PDF/UA-2 in the footer when the document's metadata declares them.
- ESM and CommonJS entry points, with type declarations that resolve under Node16 and NodeNext.
