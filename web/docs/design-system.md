# ShieldBinary UI System

This frontend now uses a reusable cyber-glassmorphism design system.

## Core Principles

- Consistent tokens first (colors, spacing, radius, motion).
- Immersive visuals with restrained interaction latency.
- Accessibility preserved through focus-visible, semantic controls, and reduced-motion support.

## Files

- Theme and global effects: `web/src/index.css`
- Primitive components: `web/src/design-system/primitives.tsx`
- Primitive exports: `web/src/design-system/index.ts`

## Primitive Components

- `Button` (`primary`, `ghost`, `danger`, `success`; `sm|md|lg`)
- `Card`
- `Panel` (`default`, `success`, `danger`, `warning`)
- `Badge` (`neutral`, `accent`, `success`, `warning`, `danger`)
- `Input`
- `Select`
- `Checkbox`
- `Progress`
- `Alert` (`info`, `success`, `warning`, `danger`)

## Usage Notes

- Prefer primitives over inline ad-hoc styling for new UI.
- Keep status tones semantically aligned:
  - success for completed/safe states
  - warning for cautionary states
  - danger for failures or destructive actions
- Avoid long-running, blocking animations on critical actions.
- Respect `prefers-reduced-motion`; non-essential effects should degrade automatically.

## Migration Strategy

- Existing high-surface pages should be migrated incrementally to primitives.
- When touching legacy inline sections, convert those local blocks to primitives/classes rather than adding new inline style objects.
