# Vendored dependencies

Both are vendored rather than loaded from a CDN so that an archived copy of this
repository (e.g. the Zenodo deposit) renders correctly without network access.

## `d3.v7.9.0.min.js`

[D3](https://d3js.org) v7.9.0 — ISC licence, © Mike Bostock.
Retrieved from cdnjs; sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i

## `fonts/libre-franklin-*.woff2`

[Libre Franklin](https://github.com/googlefonts/Libre-Franklin) v20 (variable,
weights 400–700) — SIL Open Font Licence 1.1, © The Libre Franklin Project
Authors. Designed by Pablo Impallari, Rodrigo Fuenzalida and Nhung Nguyen as a
reinterpretation of Morris Fuller Benton's 1912 Franklin Gothic.

Two subsets are included: `latin` and `latin-ext`. The `@font-face` rule prefers
a locally installed Franklin Gothic or Libre Franklin via `local()` and falls
back to these files.

Georgia is not vendored — it ships with macOS and Windows, and the stack falls
back to Iowan Old Style and Times New Roman where it is absent.
