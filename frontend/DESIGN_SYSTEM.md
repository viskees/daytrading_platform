
# Frontend design system

This project has **one** set of styling primitives used by the authenticated UI (and should also be used by the public anding page).

## Source of truth files

### Tokens & theme
- `frontend/src/index.css`
  - CSS variables for light/dark palettes
  - Base styles (`body`, `border-border`)
  - Legacy utility classes kept for compatibility (`.container`, `.card`, `.btn`, ...)

- `frontend/tailwind.config.js`
  - Maps Tailwind semantic tokens to CSS variables
  - Enables classes like `bg-background`, `text-foreground`, `border-input`, `text-muted-foreground`, etc.

### UI primitives (preferred)
Located in `frontend/src/components/ui/*`.

These are the components the authenticated pages use (e.g. the login flow in `App.tsx`):
- `card.tsx` (`<Card/>`, `<CardContent/>`, ...)
- `button.tsx` (`<Button/>`, variants)
- `input.tsx`, `textarea.tsx`
- `switch.tsx`
- `badge.tsx`, `progress.tsx`

### Classname utility
- `frontend/src/lib/utils.ts` (`cn()`)

## Conventions

1. Prefer `components/ui/*` over ad-hoc Tailwind in pages.
2. Prefer semantic classes (e.g. `bg-background`, `text-muted-foreground`) over hard-coded palettes.
3. Dark mode is controlled by toggling the `dark` class on `<html>`.