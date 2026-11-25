module.exports = {
  theme: {
    extend: {
      colors: {
        background: 'var(--bg)',
        foreground: 'var(--text)',
        card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
        popover: { DEFAULT: 'var(--popover)', foreground: 'var(--popover-foreground)' },
        primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
        secondary: { DEFAULT: 'var(--surface)', foreground: 'var(--text)' },
        muted: { DEFAULT: 'var(--surface)', foreground: 'var(--text-muted)' },
        accent: { DEFAULT: 'var(--primary-soft)', foreground: 'var(--text)' },
        destructive: 'var(--danger)',
        border: 'var(--border)',
        input: 'var(--field-border)',
        ring: 'var(--primary)',
      },
    },
  },
  plugins: [],
};
