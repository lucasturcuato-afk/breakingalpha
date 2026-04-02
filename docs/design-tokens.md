# BreakingAlpha — Design Token Reference

> Single source of truth for the visual system.
> CSS variables defined in `frontend/styles/globals.css`.
> Tailwind aliases defined in `frontend/tailwind.config.ts`.

---

## Philosophy

**Bloomberg Terminal density.** Every pixel earns its place. Negative space is
a privilege, not a default. Data must be readable at a glance.

- Default to monospace for any numeric, ticker, percentage, or price value
- Four-level text hierarchy — pick the right level, don't skip
- Blue = interactive / primary action. Amber = financial highlight / watchlist.
- Green/Red = market direction only. Don't use them for unrelated status.

---

## Color System

### Base Surfaces

| Token              | Hex        | CSS Variable    | Tailwind Class     | Use                              |
|--------------------|------------|-----------------|--------------------|----------------------------------|
| Background         | `#04040b`  | `var(--bg)`     | `bg-bg`            | Page background                  |
| Surface            | `#08080f`  | `var(--surface)`| `bg-surface`       | Cards, panels, sidebar           |
| Surface 2          | `#0c0c16`  | `var(--surface-2)`| `bg-surface-2`   | Modals, tooltips, dropdowns      |
| Surface 3          | `#10101d`  | `var(--surface-3)`| `bg-surface-3`   | Table row hover, selected state  |

### Borders

| Token     | Hex        | CSS Variable      | Use                            |
|-----------|------------|-------------------|--------------------------------|
| Border    | `#1a1a2e`  | `var(--border)`   | Default divider / row separator|
| Border 2  | `#22223a`  | `var(--border-2)` | Card outline                   |
| Border 3  | `#2e2e4a`  | `var(--border-3)` | Input focus ring (non-blue)    |

### Electric Blue (Primary)

| Token         | Hex        | CSS Variable          | Use                            |
|---------------|------------|-----------------------|--------------------------------|
| Blue          | `#1d6ef5`  | `var(--blue)`         | Links, CTAs, active nav        |
| Blue Bright   | `#4d8fff`  | `var(--blue-bright)`  | Hover state                    |
| Blue Dim      | `#1043a8`  | `var(--blue-dim)`     | Pressed / active               |
| Blue Muted    | `#1d6ef518`| `var(--blue-muted)`   | Subtle tint (selected row bg)  |

### Amber (Financial Accent)

| Token         | Hex        | CSS Variable          | Use                              |
|---------------|------------|-----------------------|----------------------------------|
| Amber         | `#e8940a`  | `var(--amber)`        | Watchlist, highlighted thesis    |
| Amber Bright  | `#f5b228`  | `var(--amber-bright)` | Hover on amber elements          |
| Amber Muted   | `#e8940a14`| `var(--amber-muted)`  | Subtle bg for amber-tagged items |

### Market Direction

| Token          | Hex        | CSS Variable       | Use                         |
|----------------|------------|--------------------|-----------------------------|
| Green          | `#16c25e`  | `var(--green)`     | Positive gain, bullish      |
| Green Muted    | `#16c25e14`| `var(--green-muted)`| Subtle positive bg          |
| Red            | `#e83a3a`  | `var(--red)`       | Negative loss, bearish      |
| Red Muted      | `#e83a3a14`| `var(--red-muted)` | Subtle negative bg          |
| Yellow         | `#f0c040`  | `var(--yellow)`    | Neutral / pending / flagged |
| Purple         | `#8b5cf6`  | `var(--purple)`    | AI signal / model output    |

**Rule:** Green/Red are reserved for market direction. Do not use them for
generic success/error states in UI forms — use blue (info) and red only when
the context is financial.

### Text Hierarchy

| Level   | Hex        | CSS Variable    | Tailwind Class  | Use                               |
|---------|------------|-----------------|-----------------|-----------------------------------|
| Text 1  | `#e8e8f5`  | `var(--text)`   | `text-text-1`   | Headlines, key data, company name |
| Text 2  | `#a0a0c0`  | `var(--text-2)` | `text-text-2`   | Body copy, labels, metadata       |
| Text 3  | `#60607a`  | `var(--text-3)` | `text-text-3`   | Timestamps, footnotes, col headers|
| Text 4  | `#32324a`  | `var(--text-4)` | `text-text-4`   | Disabled, placeholder             |
| Inverse | `#04040b`  | `var(--text-inv)`| `text-text-inv`| Text on bright accent backgrounds |

---

## Typography

### Font Families

| Role   | Value                                     | CSS Variable      | Tailwind         | Use                          |
|--------|-------------------------------------------|-------------------|------------------|------------------------------|
| Mono   | DM Mono, JetBrains Mono, monospace        | `var(--font-mono)`| `font-mono`      | ALL numbers, prices, tickers |
| Sans   | DM Sans, Inter, system-ui                 | `var(--font-sans)`| `font-sans`      | Body copy, cards, nav        |
| Label  | Inter, DM Sans, system-ui                 | `var(--font-label)`| `font-label`    | Column headers, tags, badges |

**Critical rule:** Any value that changes (price, %, market cap, volume) must
use `font-mono` with `tabular-nums` to prevent layout jitter on data updates.

### Type Scale

| Name  | Size  | Line Height | Usage                   |
|-------|-------|-------------|-------------------------|
| 2xs   | 10px  | 14px        | Micro labels, badges    |
| xs    | 11px  | 15px        | Column headers, tags    |
| sm    | 12px  | 16px        | Table body, metadata    |
| base  | 13px  | 20px        | Default body            |
| md    | 14px  | 20px        | Slightly emphasized body|
| lg    | 16px  | 22px        | Section subheadings     |
| xl    | 18px  | 26px        | Section headings        |
| 2xl   | 22px  | 30px        | Page subheadings        |
| 3xl   | 28px  | 36px        | Page headings           |
| 4xl   | 36px  | 44px        | Hero / dashboard KPI    |

---

## Spacing

The spacing scale is ~70% of Tailwind defaults — intentionally tighter for
information-dense layouts. Use the Tailwind class names normally; the values
are just smaller.

| Class | BA Value | Tailwind Default | Notes                    |
|-------|----------|------------------|--------------------------|
| p-1   | 3px      | 4px              | Micro insets (badges)    |
| p-2   | 7px      | 8px              | Default inner padding    |
| p-3   | 11px     | 12px             | Card padding sm          |
| p-4   | 14px     | 16px             | Card padding default     |
| p-6   | 22px     | 24px             | Section spacing          |
| p-8   | 28px     | 32px             | Large section gap        |

**Table rows:** Use `py-1.5 px-3` (5px × 11px) for dense table rows.
Target row height ~28–32px.

---

## Border Radius

Terminal aesthetic — keep it tight.

| Token   | Value | Use                        |
|---------|-------|----------------------------|
| none    | 0px   | Data table cells, terminal |
| sm      | 2px   | Inline badges, tags        |
| default | 3px   | Cards, inputs              |
| md      | 4px   | Buttons, dropdowns         |
| lg      | 6px   | Modals, larger panels      |

---

## Shadows / Glow

| Token          | Use                                 |
|----------------|-------------------------------------|
| `shadow-sm`    | Subtle card lift                    |
| `shadow`       | Card / popover default              |
| `shadow-md`    | Dropdown / context menu             |
| `shadow-lg`    | Modal                               |
| `shadow-glow-blue`  | Active/selected panel highlight|
| `shadow-glow-amber` | Watchlisted item highlight     |
| `shadow-glow-positive` | Green flash on price up     |
| `shadow-glow-negative` | Red flash on price down     |

---

## Z-Index Scale

| Variable       | Value | Layer                          |
|----------------|-------|--------------------------------|
| `--z-base`     | 0     | Normal document flow           |
| `--z-raised`   | 10    | Sticky table header            |
| `--z-dropdown` | 20    | Dropdowns, select menus        |
| `--z-sticky`   | 30    | Sticky sidebar, top nav        |
| `--z-overlay`  | 40    | Sheet / drawer                 |
| `--z-modal`    | 50    | Dialogs                        |
| `--z-toast`    | 60    | Toasts / notifications         |
| `--z-tooltip`  | 70    | Tooltips (always on top)       |

---

## Layout Constants

| Variable           | Value  | Use                                |
|--------------------|--------|------------------------------------|
| `--sidebar-width`  | 220px  | Left nav sidebar                   |
| `--header-height`  | 44px   | Top bar                            |
| `--panel-min`      | 280px  | Minimum resizable panel width      |
| `--content-max`    | 1440px | Max content width                  |

---

## Animation Conventions

| Duration | Use                           |
|----------|-------------------------------|
| 80ms     | Instant feedback (hover tint) |
| 120ms    | Color transitions             |
| 180ms    | Fade in / slide in            |
| 300ms    | Modal / panel open            |

**Price flash pattern:**
```css
.flash-positive { animation: pulse-positive 600ms ease 2; }
.flash-negative { animation: pulse-negative 600ms ease 2; }
```

---

## Component Patterns

### Dense Table Row
```html
<tr class="border-b border-border hover:bg-surface-3 transition-colors duration-80">
  <td class="py-1.5 px-3 text-sm text-text-1 font-mono tabular-nums">AAPL</td>
  <td class="py-1.5 px-3 text-sm font-mono tabular-nums text-positive">+2.4%</td>
</tr>
```

### KPI Card
```html
<div class="bg-surface border border-border-2 rounded p-4">
  <p class="text-xs font-label text-text-3 uppercase tracking-widest">Market Cap</p>
  <p class="text-2xl font-mono tabular-nums text-text-1 mt-1">$2.84T</p>
  <p class="text-xs font-mono text-positive mt-0.5">+1.2% today</p>
</div>
```

### Column Header
```html
<th class="px-3 py-2 text-xs font-label font-medium text-text-3 uppercase tracking-widest
           text-left border-b border-border-2 whitespace-nowrap">
  Volume (30d)
</th>
```
