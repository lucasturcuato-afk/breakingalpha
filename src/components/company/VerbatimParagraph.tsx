/**
 * The ONE place licensed text becomes a DOM node.
 *
 * WHY A COMPONENT EXISTS FOR A `<p>` TAG. The `VerbatimText` brand stops a
 * shortened string from being assigned back INTO a verbatim slot. It does not
 * stop a shortened string from being RENDERED, because JSX children are typed
 * `ReactNode`, and `ReactNode` accepts plain `string`. Measured with `tsc
 * --noEmit` on the shipped tree: `{identity.text.slice(0, 200) + "…"}`
 * inside the overview element compiled with zero errors. The brand held
 * everywhere except at the last inch, which is the only inch a reader sees.
 *
 * So the render sites do not interpolate the paragraph themselves. They hand it
 * to this component, whose `text` prop is `VerbatimText`. Slicing, trimming,
 * replacing or interpolating at a call site produces plain `string` and stops
 * type-checking here (TS2322), which is what "a truncation between the module
 * and the DOM is a compile error" has to mean to be true.
 *
 * THE `{text}` BELOW IS THE IRREDUCIBLE LEAF. Something, somewhere, has to pass
 * a branded string into an unbranded `ReactNode` slot. The point of this file
 * is that it is exactly one expression in one file with nothing else in it,
 * rather than an expression at every render site. Do not add a `maxLength`, a
 * clamp computed in JS, an ellipsis, or any other prop that could shorten what
 * arrives. A CSS line-clamp on the caller's `className` is fine: the full text
 * is still in the document and still copyable.
 *
 * The licence rule this serves is in `src/lib/company-identity.ts`. Short
 * version: verbatim reproduction is clean under CC BY-SA 4.0 section
 * 2(a)(1)(A); any trim makes it Adapted Material under 1(a) and fires the
 * ShareAlike condition in 3(b) on Signalera's own identity prose.
 */

import type { CSSProperties } from "react";

import type { VerbatimText } from "@/lib/company-identity";

interface VerbatimParagraphProps {
  /**
   * The licensed paragraph, branded. A plain `string` is rejected here on
   * purpose: if it is not branded it did not come through
   * `wikipediaArtifact()`, and if it did come through and lost the brand,
   * something shortened it on the way.
   */
  text: VerbatimText;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

export function VerbatimParagraph({
  text,
  className,
  style,
  "data-testid": testId,
}: VerbatimParagraphProps) {
  return (
    <p data-testid={testId} data-verbatim="cc-by-sa" className={className} style={style}>
      {text}
    </p>
  );
}
