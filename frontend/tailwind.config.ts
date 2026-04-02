import type { Config } from 'tailwindcss'

/**
 * BreakingAlpha — Tailwind Configuration
 *
 * Design intent: Bloomberg Terminal density.
 * - Spacing scale shifted ~30% tighter than Tailwind defaults
 * - All colors reference CSS variables (single source of truth in globals.css)
 * - Monospace font class for all numeric/data content
 * - Custom data-dense component layer sizes
 *
 * Install: npm install -D tailwindcss postcss autoprefixer
 *          npx tailwindcss init -p
 */
const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx}',
    './styles/**/*.css',
  ],

  darkMode: 'class', // explicit class toggle, always dark in BA

  theme: {
    // ── Override (replaces defaults entirely) ──────────────────────────────

    /**
     * Tight spacing scale — each step ~70% of Tailwind default.
     * Key values preserved at semantic names for legibility.
     *
     * Default → BA equivalent:
     *   p-1  (4px)  → p-1  (3px)
     *   p-2  (8px)  → p-2  (7px)
     *   p-4  (16px) → p-4  (14px)
     *   p-6  (24px) → p-6  (22px)
     *   p-8  (32px) → p-8  (28px)
     */
    spacing: {
      px:    '1px',
      '0':   '0px',
      '0.5': '2px',
      '1':   '3px',
      '1.5': '5px',
      '2':   '7px',
      '2.5': '9px',
      '3':   '11px',
      '3.5': '12px',
      '4':   '14px',
      '5':   '18px',
      '6':   '22px',
      '7':   '26px',
      '8':   '28px',
      '9':   '32px',
      '10':  '36px',
      '11':  '40px',
      '12':  '44px',
      '14':  '50px',
      '16':  '56px',
      '20':  '70px',
      '24':  '84px',
      '28':  '96px',
      '32':  '112px',
      '36':  '128px',
      '40':  '144px',
      '48':  '168px',
      '56':  '196px',
      '64':  '224px',
      '72':  '252px',
      '80':  '280px',
      '96':  '336px',
      // Named semantic sizes
      'sidebar':   '220px',
      'header':    '44px',
      'panel-sm':  '280px',
      'panel-md':  '360px',
      'panel-lg':  '480px',
    },

    fontFamily: {
      mono:  ['DM Mono', 'JetBrains Mono', 'Courier New', 'monospace'],
      sans:  ['DM Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      label: ['Inter', 'DM Sans', 'system-ui', 'sans-serif'],
    },

    fontSize: {
      '2xs': ['10px', { lineHeight: '14px', letterSpacing: '0.02em' }],
      'xs':  ['11px', { lineHeight: '15px', letterSpacing: '0.01em' }],
      'sm':  ['12px', { lineHeight: '16px' }],
      'base':['13px', { lineHeight: '20px' }],
      'md':  ['14px', { lineHeight: '20px' }],
      'lg':  ['16px', { lineHeight: '22px' }],
      'xl':  ['18px', { lineHeight: '26px' }],
      '2xl': ['22px', { lineHeight: '30px', letterSpacing: '-0.01em' }],
      '3xl': ['28px', { lineHeight: '36px', letterSpacing: '-0.02em' }],
      '4xl': ['36px', { lineHeight: '44px', letterSpacing: '-0.02em' }],
    },

    borderRadius: {
      none: '0px',
      sm:   '2px',
      DEFAULT: '3px',
      md:   '4px',
      lg:   '6px',
      xl:   '8px',
      '2xl':'12px',
      full: '9999px',
    },

    // ── Extend (merges with defaults) ──────────────────────────────────────
    extend: {
      colors: {
        // All colors reference CSS variables defined in globals.css
        // This keeps the color system in one place.
        bg:        'var(--bg)',
        surface:   'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',

        border:    'var(--border)',
        'border-2':'var(--border-2)',
        'border-3':'var(--border-3)',

        // Text hierarchy
        'text-1':  'var(--text)',
        'text-2':  'var(--text-2)',
        'text-3':  'var(--text-3)',
        'text-4':  'var(--text-4)',
        'text-inv':'var(--text-inverse)',

        // Accents
        blue:       'var(--blue)',
        'blue-bright':'var(--blue-bright)',
        'blue-dim': 'var(--blue-dim)',
        'blue-muted':'var(--blue-muted)',

        amber:      'var(--amber)',
        'amber-bright':'var(--amber-bright)',
        'amber-muted':'var(--amber-muted)',

        // Market direction
        positive:   'var(--green)',
        'positive-muted':'var(--green-muted)',
        negative:   'var(--red)',
        'negative-muted':'var(--red-muted)',
        neutral:    'var(--yellow)',
        signal:     'var(--purple)',
        'signal-muted':'var(--purple-muted)',
      },

      fontVariantNumeric: {
        tabular: 'tabular-nums',
      },

      boxShadow: {
        sm:    '0 1px 2px rgba(0,0,0,0.5)',
        DEFAULT:'0 2px 8px rgba(0,0,0,0.6)',
        md:    '0 4px 16px rgba(0,0,0,0.7)',
        lg:    '0 8px 32px rgba(0,0,0,0.8)',
        'glow-blue': '0 0 12px var(--blue-glow)',
        'glow-amber':'0 0 12px var(--amber-glow)',
        'glow-positive':'0 0 10px rgba(22,194,94,0.15)',
        'glow-negative':'0 0 10px rgba(232,58,58,0.15)',
      },

      borderColor: {
        DEFAULT: 'var(--border)',
      },

      maxWidth: {
        content: '1440px',
        prose:   '680px',
      },

      height: {
        header: 'var(--header-height)',
      },

      width: {
        sidebar: 'var(--sidebar-width)',
      },

      transitionDuration: {
        '80':  '80ms',
        '120': '120ms',
        '200': '200ms',
      },

      transitionTimingFunction: {
        'out-smooth': 'cubic-bezier(0.2, 0, 0, 1)',
      },

      keyframes: {
        'pulse-positive': {
          '0%, 100%': { color: 'var(--green)' },
          '50%':       { color: 'var(--green-bright)' },
        },
        'pulse-negative': {
          '0%, 100%': { color: 'var(--red)' },
          '50%':       { color: 'var(--red-bright)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(8px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
      },

      animation: {
        'pulse-positive': 'pulse-positive 600ms ease 2',
        'pulse-negative': 'pulse-negative 600ms ease 2',
        'fade-in':        'fade-in 180ms ease forwards',
        'slide-in-right': 'slide-in-right 180ms ease forwards',
      },
    },
  },

  plugins: [],
}

export default config
