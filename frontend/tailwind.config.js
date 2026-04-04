/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],

  theme: {
    /* ── Typography scale (px → rem) ── */
    fontSize: {
      '11': ['0.6875rem', { lineHeight: '1rem' }],
      '12': ['0.75rem', { lineHeight: '1rem' }],
      '13': ['0.8125rem', { lineHeight: '1.25rem' }],
      '14': ['0.875rem', { lineHeight: '1.25rem' }],
      '16': ['1rem', { lineHeight: '1.5rem' }],
      '18': ['1.125rem', { lineHeight: '1.75rem' }],
      '24': ['1.5rem', { lineHeight: '2rem' }],
      '32': ['2rem', { lineHeight: '2.5rem' }],
    },

    extend: {
      /* ── Color tokens ── */
      colors: {
        base: {
          DEFAULT: 'var(--sig-bg-base)',
          surface: 'var(--sig-bg-surface)',
          elevated: 'var(--sig-bg-elevated)',
          overlay: 'var(--sig-bg-overlay)',
        },
        border: {
          subtle: 'var(--sig-border-subtle)',
          DEFAULT: 'var(--sig-border-default)',
          strong: 'var(--sig-border-strong)',
        },
        content: {
          primary: 'var(--sig-text-primary)',
          secondary: 'var(--sig-text-secondary)',
          muted: 'var(--sig-text-muted)',
        },
        signal: {
          400: 'var(--sig-signal-400)',
          500: 'var(--sig-signal-500)',
          600: 'var(--sig-signal-600)',
          muted: 'var(--sig-signal-muted)',
        },
        live: {
          DEFAULT: 'var(--sig-live-red)',
        },
        draft: {
          DEFAULT: 'var(--sig-draft-amber)',
        },
        ai: {
          DEFAULT: 'var(--sig-ai-violet)',
          muted: 'var(--sig-ai-muted)',
        },
        meta: {
          DEFAULT: 'var(--sig-meta-slate)',
        },
      },

      /* ── Font families ── */
      fontFamily: {
        display: ['var(--sig-font-display)', 'system-ui', 'sans-serif'],
        body: ['var(--sig-font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--sig-font-mono)', 'monospace'],
      },

      /* ── Spacing (4px base) ── */
      spacing: {
        '0.5': '2px',
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
        '16': '64px',
      },

      /* ── Border radii ── */
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },

      /* ── Motion ── */
      transitionDuration: {
        fast: '100ms',
        base: '150ms',
        slow: '200ms',
      },
      transitionTimingFunction: {
        sig: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },

      /* ── Shadows (layered dark surfaces) ── */
      boxShadow: {
        'surface': '0 1px 2px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--sig-border-subtle)',
        'elevated': '0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--sig-border-subtle)',
        'overlay': '0 8px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--sig-border-default)',
      },
    },
  },

  plugins: [],
}
