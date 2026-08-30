# The mobile entrance runs at 40ms interval and 22px amplitude, deviating from both references

Date: 2026-08-30
Ruled by: Noah

**Interval: 40ms.** Both references measure 40, and the 60ms that shipped was
cited from a line that is not about this animation.

**Amplitude: 22px, not 12.** This is a deliberate override of both references.
12px is roughly 3mm on a phone: it reads as a fade rather than an arrival.
Desktop and the prototype were drawn for larger canvases, where 12px is a
proportionally larger move.

## Why

### The measurements, so nobody "corrects" the 22 back to 12

| Reference | Width | translateY | Duration | Easing | Rung gaps |
|---|---|---|---|---|---|
| Desktop `/dashboard` | 1440 | **12px** | 720ms | `cubic-bezier(0.16, 1, 0.3, 1)` | 80/20/40/40/120/20/20/40/40 |
| Prototype `dash` flag | 390 | **12px** | 720ms | `cubic-bezier(0.16, 1, 0.3, 1)` | 80/20/40/40/40/40/40/40/80, modal gap **40ms** |

Both agree on 12px, 720ms and the easing. **The interval is overridden by
evidence; the amplitude is overridden by judgement, and that difference is the
whole point of writing this down.**

### The 60ms had no source

Handoff line 2866 reads: *"Content rises fourteen pixels ... staggered by about
sixty milliseconds down the landing."* **That sentence is about the landing.**
The dashboard flag itself measures 12px and 40ms, and the 60ms that shipped in
an earlier PR was cited from that line without checking that the line described
a different screen. A number lifted from a sentence about another surface is
not a reference measurement.

### What the interval costs in ladder length

| Rungs | At 40ms | At 60ms |
|---|---|---|
| 10 | 1080ms | 1257ms |
| 7 | 960ms | 1076ms |
| 6 | 920ms | 1019ms |

The 40ms ladder finishes inside a second at every real rung count. The 60ms one
does not at 10, and a reader who waits 1.26s for the page to stop moving reads
that as slowness rather than as an entrance.

### Why the amplitude is overridden rather than matched

At 390 CSS px on a typical phone, 12px is about 3mm of physical travel. That is
under the threshold where the eye reads motion as a thing arriving from
somewhere; it reads as opacity alone. The same 12px on a 1440 desktop canvas
sits in a much larger field of view and does read as a move. **The references
are not wrong about their own canvases.** They were measured on canvases this
one is not, and copying the pixel value across canvas sizes copies the number
while losing the effect it was chosen to produce. 22px restores the effect at
phone width. Duration and easing are unchanged, so the extra distance does not
buy a slower page.

### The ladder is computed over rungs that render, not by fixed index

Constants tuned against the fixture failed twice, and this is why: **8 of 12
rungs render on a live account**, and the hole count varies per reader. A
ladder indexed by position in the full list assigns delays to rungs that are
not there, so a live reader gets gaps in the stagger and a ladder longer than
the numbers above. Computing over the rendered set is what makes the 40ms
figure describe what the reader actually sees.

## What would change the answer

- **A measurement showing 22px overshoots.** The override rests on a judgement
  about physical travel at phone width, not on a number. If a reader test or a
  frame capture shows the arrival reading as a jump rather than a rise, the
  amplitude is the thing to move, and it moves down toward 16 before it moves
  back to 12.
- **A canvas change.** The reasoning is scoped to phone widths. A tablet or
  foldable layout is a different canvas and inherits the reasoning, not the
  number.
- **Nothing reopens the 40ms.** Both references measure it and the 60ms had no
  support. That half is settled unless a reference itself changes.
- **The rendered-rung computation is not a preference.** It stays as long as
  the rung set is conditional, which it is while any tier can be absent for a
  reader. If every rung became unconditional, fixed-index delays would be
  equivalent, and only then.
