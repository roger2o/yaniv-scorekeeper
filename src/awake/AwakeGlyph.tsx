/**
 * The keep-the-screen-on control's state glyphs, as INLINE SVG.
 *
 * WHY NOT EMOJI, WHICH IS WHAT THIS SHIPPED WITH FIRST. The two glyphs it used —
 * 💡 U+1F4A1 and 💤 U+1F4A4 — both carry the Unicode property
 * `Emoji_Presentation=Yes`, which means the platform draws them in its OWN
 * colours and a CSS `color` on them does nothing at all. Checked directly rather
 * than assumed, with Node's Unicode property escapes:
 *
 *     /\p{Emoji_Presentation}/u.test('💡')  ->  true
 *     /\p{Emoji_Presentation}/u.test('💤')  ->  true
 *     /\p{Emoji_Presentation}/u.test('⚠')   ->  false
 *
 * So four of the contrast figures this control's CSS used to quote described a
 * colour that never painted: the "greyed-out" unsupported bulb was in fact a
 * full-colour yellow bulb with a grey slash across it. The third, ⚠, is
 * `Emoji_Presentation=No`, which is worse in its own way — it is monochrome on
 * some platforms and a colour emoji on others, so the state's appearance was
 * decided by the phone. Since the glyph is the SOLE carrier of this control's
 * state, WCAG 1.4.11's graphical-object clause applies to it, and a figure that
 * cannot be controlled cannot be met.
 *
 * SVG paths filled and stroked with `currentColor` fix that outright: the glyph
 * is whatever colour the button's `color` says, in both themes, on every
 * platform. It also removes the last font dependency from this control — the
 * project already has an open follow-up about two button symbols that are NOT in
 * the bundled font files and so render at an unpredictable width on each phone.
 * A path in the bundle cannot go missing offline and cannot be substituted.
 *
 * MEANING WITHOUT COLOUR. The five shapes are deliberately different SHAPES, not
 * five colours of the same shape: a lit bulb, a hollow bulb, a moon, a warning
 * triangle, a hollow bulb struck through. Read in a single colour, they still say
 * which state the control is in.
 */

/** The five things the control can be showing. */
export type AwakeVisualState = 'on' | 'waiting' | 'off' | 'blocked' | 'unsupported';

/** Shared attributes. 24px matches the emoji size this replaces. */
const SVG_PROPS = {
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  'aria-hidden': true,
  focusable: false,
} as const;

/** The bulb's metal base — the same in every bulb state. */
function BulbBase() {
  return (
    <>
      <rect x="9" y="15.6" width="6" height="2.2" rx="1.1" fill="currentColor" />
      <rect x="9.9" y="18.9" width="4.2" height="2.1" rx="1.05" fill="currentColor" />
    </>
  );
}

export function AwakeGlyph({ state }: { state: AwakeVisualState }) {
  if (state === 'on') {
    // Lit: a solid bulb throwing light.
    return (
      <svg {...SVG_PROPS}>
        <circle cx="12" cy="9.4" r="5.8" fill="currentColor" />
        <BulbBase />
        <g
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M12 0.9v1.6" />
          <path d="M4.1 3.6l1.2 1.2" />
          <path d="M19.9 3.6l-1.2 1.2" />
          <path d="M0.9 9.4h1.6" />
          <path d="M21.5 9.4h1.6" />
        </g>
      </svg>
    );
  }

  if (state === 'waiting') {
    // Asked for, not in hand at this moment: the same bulb, unlit and unfilled.
    return (
      <svg {...SVG_PROPS}>
        <circle
          cx="12"
          cy="9.4"
          r="5.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <BulbBase />
      </svg>
    );
  }

  if (state === 'unsupported') {
    // The same unlit bulb, struck through. The stroke is part of the drawing
    // rather than a CSS pseudo-element, so it cannot drift out of alignment with
    // the shape it is crossing.
    return (
      <svg {...SVG_PROPS}>
        <circle
          cx="12"
          cy="9.4"
          r="5.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <BulbBase />
        <path
          d="M3.4 20.6 20.6 3.4"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    );
  }

  if (state === 'blocked') {
    // The phone refused. A warning triangle, not a bulb — a refusal is not a
    // dimmer setting.
    return (
      <svg {...SVG_PROPS}>
        <path
          d="M12 2.6 22.2 20.4H1.8L12 2.6Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M12 9.4v4.6"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="17.4" r="1.2" fill="currentColor" />
      </svg>
    );
  }

  // 'off' — the phone may sleep normally, by the scorekeeper's own choice.
  return (
    <svg {...SVG_PROPS}>
      <path
        d="M21.2 13.6A9.2 9.2 0 1 1 10.4 2.8 7.2 7.2 0 0 0 21.2 13.6Z"
        fill="currentColor"
      />
    </svg>
  );
}
