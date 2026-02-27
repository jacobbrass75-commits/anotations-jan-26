# TASK: Theme Overhaul (feature/theme)

**Workstream:** Darling (Light) + Eva (Dark) Theme System
**Branch:** `feature/theme`
**Worktree:** `sm-theme/`
**Dependencies:** None

---

## Objective

Create two anime-inspired but professional themes. Light mode ("Darling") becomes the default. Dark mode ("Eva") gets refined for better legibility. BootSequence and DataTicker become opt-in Easter eggs in dark mode settings.

---

## Files to Modify

### 1. `client/src/index.css` — Complete Theme Variable Overhaul

Replace the existing `:root` (light mode) CSS variables with the "Darling" theme:

```css
/* LIGHT MODE — "Darling" */
/* Inspired by Darling in the Franxx. Warm, clean, confident. */
:root {
  /* Base */
  --background: 40 14% 98%;          /* #FAFAF8 warm white */
  --foreground: 28 5% 16%;           /* #2D2A26 warm charcoal */

  /* Cards & Surfaces */
  --card: 30 13% 96%;                /* #F5F3F0 soft cream */
  --card-foreground: 28 5% 16%;
  --card-border: 25 8% 90%;          /* #E8E4E0 blush gray */

  /* Sidebar */
  --sidebar: 30 13% 95%;
  --sidebar-foreground: 28 5% 16%;
  --sidebar-border: 25 8% 90%;
  --sidebar-primary: 350 50% 59%;    /* #D4556B muted rose */
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 30 10% 92%;
  --sidebar-accent-foreground: 28 5% 16%;
  --sidebar-ring: 350 50% 59%;

  /* Popover */
  --popover: 30 13% 96%;
  --popover-foreground: 28 5% 16%;
  --popover-border: 25 8% 90%;

  /* Primary — Muted Rose (Zero Two red, pulled back 40%) */
  --primary: 350 50% 59%;            /* #D4556B */
  --primary-foreground: 0 0% 100%;

  /* Secondary — Calm Blue (Franxx blue, desaturated) */
  --secondary: 212 28% 50%;          /* #5B7FA5 */
  --secondary-foreground: 0 0% 100%;

  /* Muted */
  --muted: 25 8% 92%;
  --muted-foreground: 25 4% 52%;     /* #8A8580 warm gray */

  /* Accent */
  --accent: 25 8% 93%;
  --accent-foreground: 28 5% 16%;

  /* Borders & Input */
  --border: 25 8% 90%;               /* #E8E4E0 barely-there blush gray */
  --input: 25 8% 78%;
  --ring: 350 50% 59%;

  /* Success / Active — Soft Teal */
  --success: 168 27% 49%;            /* #5A9E8F */

  /* Destructive — Warm Rose */
  --destructive: 354 55% 53%;        /* #C94454 */
  --destructive-foreground: 0 0% 98%;

  /* Charts */
  --chart-1: 350 50% 50%;            /* Rose */
  --chart-2: 168 27% 49%;            /* Teal */
  --chart-3: 212 28% 50%;            /* Blue */
  --chart-4: 40 70% 55%;             /* Amber */
  --chart-5: 25 50% 60%;             /* Warm */

  /* Typography */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-serif: 'Merriweather', Georgia, serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Spacing & Radius */
  --radius: 0.5rem;
  --spacing: 0.25rem;
}
```

Replace the existing `.dark` theme with the refined "Eva" theme:

```css
/* DARK MODE — "Eva" */
/* Inspired by Evangelion NERV. Refined for legibility. Orange is accent only. */
.dark {
  /* Base — Deep purple-black */
  --background: 260 30% 8%;          /* Deep NERV purple-black */
  --foreground: 30 5% 92%;           /* #EBEAE8 much more legible than before */

  /* Cards — Slightly lighter for contrast */
  --card: 260 30% 12%;
  --card-foreground: 30 5% 92%;
  --card-border: 260 20% 18%;

  /* Sidebar */
  --sidebar: 260 30% 10%;
  --sidebar-foreground: 30 5% 92%;
  --sidebar-border: 260 20% 16%;
  --sidebar-primary: 24 90% 55%;     /* Eva orange — accent only */
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 260 25% 15%;
  --sidebar-accent-foreground: 30 5% 92%;
  --sidebar-ring: 24 90% 55%;

  /* Popover */
  --popover: 260 30% 11%;
  --popover-foreground: 30 5% 92%;
  --popover-border: 260 20% 18%;

  /* Primary — Eva Orange (accent only — buttons, links, highlights) */
  --primary: 24 90% 55%;
  --primary-foreground: 0 0% 100%;

  /* Secondary */
  --secondary: 260 25% 18%;
  --secondary-foreground: 30 5% 92%;

  /* Muted — Actually readable now (65% lightness, was 55%) */
  --muted: 260 15% 16%;
  --muted-foreground: 260 10% 65%;

  /* Accent */
  --accent: 260 25% 15%;
  --accent-foreground: 30 5% 92%;

  /* Borders & Input */
  --border: 260 20% 18%;
  --input: 260 15% 25%;
  --ring: 24 90% 55%;

  /* Destructive */
  --destructive: 0 70% 55%;
  --destructive-foreground: 0 0% 98%;

  /* Charts */
  --chart-1: 24 90% 55%;             /* Orange */
  --chart-2: 120 50% 45%;            /* Green */
  --chart-3: 200 70% 55%;            /* Blue */
  --chart-4: 340 60% 55%;            /* Pink */
  --chart-5: 55 80% 55%;             /* Yellow */
}
```

### 2. Global Typography Fix (in `index.css`)

Add after the theme variables:

```css
/* Global typography — minimum 15px body text in both modes */
body {
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.6;
  color: hsl(var(--foreground));
  background-color: hsl(var(--background));
}

/* Dark mode: Rajdhani for headings only, system font for body */
.dark h1, .dark h2, .dark h3, .dark h4, .dark h5, .dark h6 {
  font-family: 'Rajdhani', var(--font-sans);
  font-weight: 600;
  letter-spacing: 0.02em;
}
```

### 3. BootSequence & DataTicker — Make Opt-In

Find these components in `client/src/components/`:

**If `BootSequence.tsx` exists:**
- Add a prop `enabled: boolean` (default `false`)
- Only render if enabled
- Read the setting from localStorage: `localStorage.getItem("sm-boot-sequence") === "true"`

**If `DataTicker.tsx` exists:**
- Same treatment: prop `enabled: boolean`, read from localStorage
- Only render if enabled

**If they don't exist:** Skip this step. They may be Easter eggs added later.

### 4. `client/src/components/ThemeToggle.tsx` (NEW or MODIFY)

Check if a theme toggle component exists. If not, create one:

```typescript
// Simple theme toggle: Light (Darling) / Dark (Eva)
// Uses next-themes (already in package.json)
// Renders a sun/moon icon button in the header
// Default: light mode (system default overridden to "light")
```

Make sure the app defaults to light mode. In the ThemeProvider setup:
```typescript
<ThemeProvider defaultTheme="light" storageKey="sm-theme">
```

### 5. Dark Mode Settings Panel

If a settings page/modal exists, add toggles for:
- "Enable Boot Sequence animation" (dark mode only)
- "Enable Data Ticker" (dark mode only)

These write to localStorage keys `sm-boot-sequence` and `sm-data-ticker`.

If no settings UI exists, skip this — the localStorage keys can be set manually for now.

### 6. Verify All UI Components

After changing theme variables, verify these shadcn/ui components look correct in both modes:
- Buttons (primary, secondary, destructive, outline, ghost)
- Cards
- Dialogs/Modals
- Inputs and forms
- Dropdowns and selects
- Toasts
- Sidebar navigation
- Scroll areas

The shadcn components use `hsl(var(--primary))` etc., so they'll automatically pick up the new colors. But check for any hardcoded colors in custom components.

---

## Search for Hardcoded Colors

Look for and replace any hardcoded color values in component files:

```bash
# Search for hardcoded hex colors or HSL values in components
grep -r "#[0-9a-fA-F]" client/src/components/ --include="*.tsx" --include="*.ts"
grep -r "hsl(" client/src/components/ --include="*.tsx" --include="*.ts"
grep -r "rgb(" client/src/components/ --include="*.tsx" --include="*.ts"
```

Replace hardcoded colors with CSS variable references where appropriate.

---

## Install Dependencies

None needed — `next-themes` is already in package.json.

If Rajdhani font isn't loaded yet, add to `client/index.html`:
```html
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet">
```

Make sure Inter is also loaded:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

---

## After Implementation

```bash
npm run check
npm run dev
```

Test:
1. Open app — should default to light mode (Darling)
2. Verify warm white background, muted rose accents, calm blue secondary
3. Toggle to dark mode (Eva)
4. Verify deep purple background, orange accents, improved text legibility
5. Verify muted text is readable (was too dark before)
6. Check that BootSequence/DataTicker don't appear by default in dark mode
7. Test all major UI interactions in both modes

---

## Important Notes

- Light mode is the NEW DEFAULT. Override any existing "dark" default.
- The colors should feel professional to non-anime fans and recognizable to fans.
- Eva orange is ACCENT ONLY in dark mode — buttons, links, active states. Not backgrounds, not cards, not text.
- Body text minimum 15px. This is non-negotiable for legibility.
- Keep Rajdhani font for headings only in dark mode. Body text uses Inter/system font in both modes.
- Don't add any anime references, logos, or text. The inspiration is purely in the color palette.
