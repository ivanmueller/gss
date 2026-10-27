# Design system

How the web app looks, and where to change it. The code lives in `apps/web/src/styles/` (tokens) and `apps/web/src/components/ui/` (components).

## Where to change what

| To change | Edit | File |
|---|---|---|
| Corner rounding everywhere (0 = square) | `--radius-base` | `styles/tokens/scales.css` |
| Rounding of one kind of element only | `--radius-control` (buttons, inputs), `--radius-card`, `--radius-badge`, `--radius-popover`, `--radius-dialog` | `styles/tokens/scales.css` |
| How dark the shadows are | `--shadow-opacity-xs` … `-lg`, per theme | `styles/tokens/themes.css` |
| What a colour is used for (e.g. a darker page in the night theme) | the role, e.g. `--background` under `.dark` | `styles/tokens/themes.css` |
| A colour itself (a shade of red) | the ramp step, e.g. `--red-600` | `styles/tokens/palette.css` |
| Add a brand colour | add its ramp to `palette.css`, then point roles (e.g. `--primary`) at it in `themes.css` | both |
| The typeface | `--font-sans` and the font import in `main.tsx` | `styles/tokens/scales.css` |
| Menu width, top bar height, page width | `--spacing-sidebar`, `--spacing-topbar`, `--container-content` | `styles/tokens/scales.css` |
| The left menu's pages | `NAV` (and `PLANNED`) | `components/AppShell.tsx` |
| The map's land, water, borders, roads and labels | `--map-land`, `--map-water`, `--map-border`, `--map-road`, `--map-label`, `--map-label-halo`, per theme | `styles/tokens/themes.css` |

After a colour change, `pnpm --filter @grain/web test` checks that text still meets WCAG AA contrast in both themes.

## Three layers

1. **Palette** (`palette.css`): raw colours as ramps from 50 (lightest) to 950 (darkest), in OKLCH. Grey (pure neutral, no tint) for the light theme; slate (a cool blue-grey, matched to the owner's reference dashboard) for the night theme; blue, green, yellow, orange, red, teal and indigo (teal and indigo are not used by any role at the moment). Apart from slate, the values are Tailwind CSS v4's palette. No brand colour yet, and nothing depends on one.
2. **Themes** (`themes.css`): what each colour is *for*, once for the light theme (`:root`, white and neutral greys) and once for the night theme (`.dark`, slate: page `#252c36`, cards `#313842`, menu a step darker). Components only ever use these roles.
3. **Scales and the Tailwind bridge** (`scales.css`): type, spacing, rounding and shadows, and the roles exposed as Tailwind classes (`bg-card`, `text-danger`, `rounded-card`, `shadow-md`). Tailwind's default colours, radii, shadows and font sizes are switched off, so only these values exist.

## Colour roles

Neutral: `background`/`foreground` (page and body text), `card` and `popover` (raised surfaces), `muted`/`muted-foreground` (quiet fills, secondary text), `accent` (hover and selection), `primary` and `secondary` (filled buttons), `border`, `input`, `ring` (keyboard focus), `sidebar-*`, `overlay`.

Status and trading roles, each with five tokens: `<role>` (text, icons, dots), `<role>-subtle` (tinted background), `<role>-border`, `<role>-solid` (filled background) and `<role>-solid-foreground` (text on it).

| Role | Ramp | Use it for |
|---|---|---|
| `info` | blue | Neutral facts, help |
| `success` | green | Done, firm, verified, connected |
| `caution` | yellow | Not yet reliable: indicative quotes, pending verification, synthetic data |
| `warning` | orange | A likely problem to check before acting: low geocoding confidence, another province |
| `danger` | red | Errors, server unreachable, destructive actions |
| `bid` | green | Buyer bids |
| `offer` | red | Seller offers, called asks in the order book |

Severity rises from info to danger. Colour never carries meaning alone: statuses, bids and offers always show a word and usually an icon. Bids and asks follow the trading convention (green and red) and so share their ramps with `success` and `danger`; they always sit under a heading or carry the word "Bid" or "Ask", so they are never read as a status.

## Scales

- **Type:** IBM Plex Sans (interface) and IBM Plex Mono (prices, codes), open source (SIL OFL) and served with the app. Sizes `2xs` 11 (dense labels, such as the order book's column headings), `xs` 12, `sm` 14 (body), `base` 16, `lg` 18, `xl` 20, `2xl` 24 (page titles), `3xl` 30 px. Inputs use 16 px on phones so the browser does not zoom in.
- **Spacing:** a 4 px grid (`p-1` = 4 px, `p-4` = 16 px). Prefer 1, 1.5, 2, 3, 4, 6, 8, 12, 16.
- **Rounding:** every radius is a multiple of `--radius-base` (8 px): `xs` 2, `sm` 4, `md` 6, `lg` 8, `xl` 12, `2xl` 16, `full`. Components use `rounded-control` (6), `rounded-badge` (4), `rounded-card` (12), `rounded-popover` (8), `rounded-dialog` (12).
- **Shadows:** `shadow-xs` cards, inputs, outline buttons; `shadow-sm` raised on hover; `shadow-md` menus; `shadow-lg` drawers and dialogs. Opacity light theme 5 / 8 / 12 / 16 %, night theme 20 / 28 / 36 / 45 %.
- **Layers:** `--z-topbar`, `--z-sidebar`, `--z-overlay`, `--z-popover`, used as `z-(--z-popover)`.

## Light and night themes

The profile menu (top right) has one **Dark mode** switch. Until someone uses it, the app follows the device's light or dark setting; after that, the switch's position is kept in this browser (`localStorage`, key `gss.theme`). `lib/theme.ts` puts the `dark` class on `<html>`; a small script in `index.html` does the same before the first paint so the page never flashes the wrong theme. Both follow the same rules, which `lib/theme.test.ts` checks. Logos, the authenticator QR code and the Mapbox map keep their own light colours.

## The map

Mapbox draws the base map; the app repaints it with the theme's map roles. The "Map" style is Mapbox's light style in the light theme (white land, grey water, like the owner's reference) and its dark style in the night theme (slate land and water); "Satellite" is the same in both. Pins use the `bid` and `offer` roles, hollow for approximate locations, and the chosen pin gets a ring in `foreground`. Mapbox cannot read CSS variables, so `components/FacilityMap.tsx` reads the tokens from the page and converts them to hex (`lib/colour.ts`) whenever the style or theme changes. Mapbox's zoom buttons and attribution are restyled in `styles/base.css`. `styles/tokens.test.ts` checks that labels and pins stand out from the land and water in both themes.

## Components (`components/ui`)

`Button` (primary, secondary, outline, ghost, danger; `asChild` styles a link as a button), `Input` and `Select`, `FileButton`, `Card` with `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Badge` (one variant per role), `Callout` (boxed notes and alerts), `Table` parts, `Tabs`, `SegmentedControl` (toggle buttons), `DropdownMenu` and `Sheet` (slide-over panel), both on Radix for keyboard and screen-reader support.

App-level pieces in `components/`: `AppShell` (left menu, top bar, page frame), `Brand` (logo slot and the GSS name), `ConnectionStatus` (the dot), `ProfileMenu`, `PageHeader`, `BackLink`, `CommodityPicker` (choose one, several or all commodities), `OrderBook` (asks and bids by commodity, in CAD), `CadPrice` (a price in CAD, marked "FX" with the original price on hover when converted), `SelectedFacility`, `FacilityMap` (the only Mapbox code).

## Layout

- **Left menu:** the GSS logo slot and name at the top (with a yellow **Demo** tag beside the name while demo data is on), then the pages. Planned pages (bids and offers, scenarios, team) are listed greyed out under "Coming next" and are not links. Below 1024 px the menu folds into a panel opened from the top bar.
- **Top bar:** a connection dot (green when the server answers; red with the words "Server unreachable" when it does not) and the profile icon, which opens "Signed in as", the **Demo data** switch, the Dark mode switch and Sign out. If the server rejects the session, a red notice appears at the top of the page and the profile icon gets a red dot.
- **Pages:** each starts with `PageHeader` (an `<h1>`, a description and actions), up to 1,408 px wide (`--container-content`). The Workspace is the exception: its `<h1>` is for screen readers only, so the map starts at the top (owner's decision).
- **Demo data:** the profile menu's Demo data switch (`lib/demo.ts`, kept in this browser under `gss.demo`, off until turned on) decides whether the Workspace shows the made-up data of `data/synthetic.ts`. The Demo tag beside GSS is the label for it; pages carry no demo notes of their own.

## Rules for new screens

- Use roles (`bg-card`, `text-muted-foreground`, `text-danger`), never palette steps or raw colour values; the night theme then works for free.
- Use the components above before writing new styles; add a component when a pattern repeats.
- Keyboard focus shows the same ring everywhere (set in `styles/base.css`); do not remove outlines.
- Numbers that line up (prices, quantities) use tabular figures (`tabular-nums`; table bodies have them by default).
