# Configuration & Setup Reference

---

## Environment Variables

Create `.env` in project root (gitignored):

```env
OPENAI_API_KEY=sk-...              # Required - OpenAI API key for all AI features
PORT=5001                          # Optional - server port (default: 5001)

# Optional pipeline tuning
CANDIDATES_PER_CHUNK=3             # Annotation candidates per chunk
VERIFIER_THRESHOLD=0.7             # Minimum quality score (0-1)
LLM_CONCURRENCY=5                  # Max parallel LLM requests

# Optional Replit AI integrations
AI_INTEGRATIONS_OPENAI_API_KEY=    # Alternative OpenAI key for context generation
AI_INTEGRATIONS_OPENAI_BASE_URL=   # Custom base URL for Replit AI
```

---

## NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `cross-env NODE_ENV=development tsx server/index.ts` | Start dev server with HMR |
| `build` | `tsx script/build.ts` | Build for production |
| `start` | `cross-env NODE_ENV=production node dist/index.cjs` | Run production build |
| `check` | `tsc` | TypeScript type checking |
| `db:push` | `drizzle-kit push` | Push schema changes to SQLite |
| `db:generate` | `drizzle-kit generate` | Generate migration files |
| `setup` | `npm install && npm run db:push` | Full initial setup |

---

## tsconfig.json

```json
{
  "include": ["client/src/**/*", "shared/**/*", "server/**/*"],
  "compilerOptions": {
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "noEmit": true,
    "incremental": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./client/src/*"],
      "@shared/*": ["./shared/*"]
    }
  }
}
```

**Path aliases**:
- `@/` -> `client/src/`
- `@shared/` -> `shared/`

---

## vite.config.ts

- **Root**: `client/`
- **Output**: `dist/public/`
- **Plugins**: React, Replit runtime error overlay, (conditional: cartographer, devBanner)
- **Resolve aliases**: `@` -> `client/src`, `@shared` -> `shared`, `@assets` -> `attached_assets`
- **Server**: Strict file serving, deny hidden files

---

## drizzle.config.ts

```typescript
{
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: { url: "./data/sourceannotator.db" }
}
```

**Important**: After modifying `shared/schema.ts` (adding/changing columns or tables), run `npm run db:push` to sync.

---

## tailwind.config.ts

- **Dark mode**: Class-based (`["class"]`)
- **Content**: `./client/index.html`, `./client/src/**/*.{js,jsx,ts,tsx}`
- **Theme**: Extended with HSL CSS variables for all colors
- **Fonts**: `sans` (Inter), `serif` (Merriweather), `mono` (JetBrains Mono)
- **Border radius**: lg=9px, md=6px, sm=3px
- **Animations**: accordion-down, accordion-up
- **Plugins**: `tailwindcss-animate`, `@tailwindcss/typography`

### Color System (CSS Variables)
All colors defined as HSL in `client/src/index.css`:
- Semantic: `--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`
- Component: `--card`, `--popover`, `--sidebar`, `--border`, `--input`, `--ring`
- Data viz: `--chart-1` through `--chart-5`
- Status: online (green), away (amber), busy (red), offline (gray)

---

## components.json (shadcn/ui)

```json
{
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "client/src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

---

## postcss.config.js

```javascript
{
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
}
```

---

## .gitignore

**Directories**: `node_modules/`, `dist/`, `.idea/`, `.vscode/`, `.replit`, `.config/`, `.cache/`, `data/`
**Files**: `.env*`, `.DS_Store`, `Thumbs.db`, `*.cjs`, `*.swp`, `*.swo`, `*.log`, `*.tsbuildinfo`

---

## Setup From Scratch

```bash
# 1. Clone
git clone git@github.com:jacobbrass75-commits/anotation-test.git
cd anotation-test

# 2. Install
npm install

# 3. Create data directory + database
mkdir -p data
npm run db:push

# 4. Configure environment
echo "OPENAI_API_KEY=sk-your-key-here" > .env

# 5. Run
npm run dev
# Open http://localhost:5001
```

---

## Production Build

```bash
npm run build          # Compiles to dist/index.cjs + dist/public/
npm run start          # Runs production server
```

Build output:
- `dist/index.cjs` - Server bundle (CommonJS)
- `dist/public/` - Static frontend assets

---

## Database Management

```bash
npm run db:push        # Apply current schema to database (safe for dev)
npm run db:generate    # Generate migration SQL files (for production migrations)
```

The database file is at `./data/sourceannotator.db`. It's gitignored. To reset, delete the file and re-run `npm run db:push`.
