# Third-party licenses

Blitz PDF Editor bundles the fonts below with the app. They are served from the app's own
files (never from Google Fonts or a CDN), fetched only when used, and embedded into saved
PDFs as subsets containing only the characters used. The SIL Open Font License 1.1 allows
bundling the fonts with software and embedding them in documents.

The JavaScript libraries and the full license texts are listed in `THIRD_PARTY_LICENSES.txt`,
generated at build time (`build-tools/licenses.ts`) and shipped in `dist/`.

## Fonts for text and signatures

| Font | Group | Styles | License | Source | npm package |
| --- | --- | --- | --- | --- | --- |
| Arimo | Sans serif | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 | The Arimo Project Authors, https://github.com/googlefonts/arimo | `@expo-google-fonts/arimo` |
| Roboto | Sans serif | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 | The Roboto Project Authors, https://github.com/googlefonts/roboto-classic | `@expo-google-fonts/roboto` |
| Open Sans | Sans serif | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 | The Open Sans Project Authors, https://github.com/googlefonts/opensans | `@expo-google-fonts/open-sans` |
| Source Sans 3 | Sans serif | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 (Reserved Font Name "Source") | Adobe, https://github.com/adobe-fonts/source-sans | `@expo-google-fonts/source-sans-3` |
| Montserrat | Sans serif | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 | The Montserrat Project Authors, https://github.com/JulietaUla/Montserrat | `@expo-google-fonts/montserrat` |
| Poppins | Sans serif | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 | The Poppins Project Authors, https://github.com/itfoundry/Poppins | `@expo-google-fonts/poppins` |
| Inter | Sans serif | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 | The Inter Project Authors, https://github.com/rsms/inter | `@expo-google-fonts/inter` |
| Tinos | Serif | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 | The Tinos Project Authors, https://github.com/googlefonts/tinos | `@expo-google-fonts/tinos` |
| Lora | Serif | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 | The Lora Project Authors, https://github.com/cyrealtype/Lora-Cyrillic | `@expo-google-fonts/lora` |
| Merriweather | Serif | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 | The Merriweather Project Authors, https://github.com/EbenSorkin/Merriweather4 | `@expo-google-fonts/merriweather` |
| Playfair Display | Serif | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 | The Playfair Display Project Authors, https://github.com/clauseggers/Playfair-Display | `@expo-google-fonts/playfair-display` |
| Cousine | Monospace | Regular, Bold, Italic, Bold Italic | SIL OFL 1.1 | The Cousine Project Authors, https://github.com/googlefonts/cousine | `@expo-google-fonts/cousine` |
| Caveat | Handwriting | Regular, Bold | SIL OFL 1.1 | The Caveat Project Authors, https://github.com/googlefonts/caveat | `@expo-google-fonts/caveat` |
| Dancing Script | Handwriting | Regular, Bold | SIL OFL 1.1 | The Dancing Script Project Authors, https://github.com/googlefonts/DancingScript | `@expo-google-fonts/dancing-script` |
| Great Vibes | Handwriting | Regular | SIL OFL 1.1 | The Great Vibes Pro Project Authors, https://github.com/googlefonts/great-vibes | `@expo-google-fonts/great-vibes` |

The labels "Arimo (Arial-style)", "Tinos (Times-style)" and "Cousine (Courier-style)" describe
the metric-compatible design only; the app never uses the names of the commercial fonts.

Lato was considered and left out: the Google Fonts build of Lato has no č or đ.

## Built-in fonts (stamps, page numbers, watermarks, older text, fallback)

| Font | License | Source | npm package |
| --- | --- | --- | --- |
| Noto Sans (Regular, Bold), Noto Serif, Noto Sans Mono | SIL OFL 1.1 | The Noto Project Authors, https://github.com/notofonts/latin-greek-cyrillic | `@expo-google-fonts/noto-sans`, `noto-serif`, `noto-sans-mono` |
| Manrope (interface font) | SIL OFL 1.1 | https://github.com/sharanda/manrope | `@fontsource/manrope` |

The npm packages themselves (the packaging, not the fonts) are MIT licensed.

## Build and test tools (not shipped)

| Tool | License | Use |
| --- | --- | --- |
| `subset-font` (with `harfbuzzjs`, `fontverter`) | BSD-3-Clause, MIT | Builds the tiny name-only preview fonts for the font picker |
| `jpeg-js` | BSD-3-Clause | JPEG encoding in compression unit tests |
