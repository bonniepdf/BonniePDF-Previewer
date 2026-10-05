# Contributing to the BonniePDF previewer

Thanks for your interest. This file covers two things: the legal basis on which
contributions are accepted, and the practical steps for getting a change in.

## Before you open a pull request

Open an issue first for anything beyond a typo or an obvious bug fix. This
component is consumed by several BonniePDF front-ends, so a change that looks
small locally can be a breaking change somewhere you cannot see. Agreeing the
approach in an issue saves rework.

## Licensing of contributions

This repository is published under the **Apache-2.0 License** (see [LICENSE](LICENSE)),
and contributions are accepted under the same terms. The grant below records
provenance and ensures clarity, as this component ships inside commercially
licensed BonniePDF distributions.

By submitting a contribution you confirm that:

1. You wrote the contribution yourself, or you have the right to submit it under
   the terms below — including any clearance you need from an employer or client.
2. You grant CodeFocus Limited a perpetual, worldwide, non-exclusive,
   royalty-free, irrevocable licence to use, reproduce, modify, prepare
   derivative works of, publicly display, sublicense, and distribute your
   contribution and such derivative works, **including as part of commercially
   licensed distributions of BonniePDF under different licence terms**.
3. You understand that you retain copyright in your contribution, and that this
   grant does not transfer ownership of it.
4. Your contribution is provided without warranty of any kind.

This is what allows a contribution to ship in both the source-available and the
paid distributions of BonniePDF. Without it, an accepted change could not be
included in the commercial product.

## Signing off your commits

We use the [Developer Certificate of Origin](https://developercertificate.org/)
rather than a separate contributor licence agreement. Add a sign-off line to
each commit:

```
Signed-off-by: Your Name <your.email@example.com>
```

`git commit -s` adds it for you. Use your real name and an email address you
can be reached at. A pull request whose commits are not signed off cannot be
merged.

## Security issues

Do not open a public issue or pull request for a suspected vulnerability. See
[SECURITY.md](SECURITY.md).

## Building and testing

```bash
pnpm build      # tsup + emitDeclarationOnly
pnpm test       # vitest (jsdom)
pnpm typecheck
```

Tests run under jsdom, which has no Shadow DOM layout, no `ResizeObserver`, and
no real font metrics. Assert structure and behaviour, not pixel geometry.


## Scope boundary

This component consumes SVG strings produced by `@bonniepdf/core`. It has no PDF
parser and no rendering engine, and should not gain one. If a preview looks
wrong, the bug is almost always in the core SVG exporter rather than here.

The element is consumed by the BonniePDF website, the desktop demo, and the VS
Code extension. A change to its attributes, events, or `load()` signature is a
breaking change for all three — treat the public surface as an API.

## Code of conduct

Be civil and assume good faith. Discussion stays on the technical merits of the
change. CodeFocus Limited may decline or revert a contribution, or restrict
participation, at its discretion.

## Questions

Open an issue, or email support@bonniepdf.dev.
