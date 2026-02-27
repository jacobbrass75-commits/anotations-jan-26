# TASK: Auth System (feature/auth)

**Workstream:** Authentication + User Management
**Branch:** `feature/auth`
**Worktree:** `sm-auth/`
**Dependencies:** None (other workstreams depend on this)

---

## Objective

Build a complete authentication system using Passport.js + JWT. Expand the existing `users` table. Add protected route middleware. All existing endpoints remain public; new auth endpoints are added alongside.

---

## Schema Changes (`shared/schema.ts`)

Expand the existing `users` table (currently only has id, username, password):

```typescript
export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(genId),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(), // bcrypt hash
  firstName: text("first_name"),
  lastName: text("last_name"),
  tier: text("tier").notNull().default("free"), // "free" | "pro" | "max"
  tokensUsed: integer("tokens_used").notNull().default(0),
  tokenLimit: integer("token_limit").notNull().default(50000), // 50K for free
  storageUsed: integer("storage_used").notNull().default(0), // bytes
  storageLimit: integer("storage_limit").notNull().default(52428800), // 50MB for free
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false),
  billingCycleStart: integer("billing_cycle_start", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()).notNull(),
});
```

Add Zod schemas:
```typescript
export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  username: true,
  password: true,
  firstName: true,
  lastName: true,
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});
```

---

## Files to Create/Modify

### 1. `server/auth.ts` (NEW)

```typescript
// Passport.js configuration + JWT utilities
// - configurePassport(app) - sets up passport with local strategy
// - generateToken(user) - creates JWT with userId, email, tier
// - verifyToken(token) - validates JWT, returns decoded payload
// - requireAuth middleware - Express middleware that validates JWT from Authorization header
// - optionalAuth middleware - like requireAuth but doesn't reject if no token
```

**Implementation details:**
- Use `bcrypt` (install: `npm install bcrypt @types/bcrypt`) for password hashing, 12 salt rounds
- Use `jsonwebtoken` (install: `npm install jsonwebtoken @types/jsonwebtoken`) for JWT
- JWT secret: `process.env.JWT_SECRET` (generate a random 64-char string for .env)
- JWT expiry: 7 days
- Token format: `{ userId: string, email: string, tier: string, iat: number, exp: number }`
- `requireAuth` middleware reads `Authorization: Bearer <token>` header, decodes, attaches `req.user`
- Add `user` property to Express Request type via declaration merging

### 2. `server/authRoutes.ts` (NEW)

Endpoints:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Create account, return JWT |
| POST | `/api/auth/login` | No | Validate credentials, return JWT |
| POST | `/api/auth/logout` | Yes | Invalidate token (optional - JWT is stateless) |
| GET | `/api/auth/me` | Yes | Return current user profile (no password) |
| PUT | `/api/auth/me` | Yes | Update profile (firstName, lastName, username) |
| GET | `/api/auth/usage` | Yes | Return token usage, storage usage, limits |

**Register flow:**
1. Validate body with `registerSchema`
2. Check email + username uniqueness
3. Hash password with bcrypt
4. Create user in DB
5. Generate JWT
6. Return `{ user: { id, email, username, tier, ... }, token: string }`

**Login flow:**
1. Validate body with `loginSchema`
2. Find user by email
3. Compare password with bcrypt
4. Generate JWT
5. Return `{ user: { ... }, token: string }`

**Usage endpoint:**
```json
{
  "tokensUsed": 12500,
  "tokenLimit": 50000,
  "tokenPercent": 25,
  "storageUsed": 10485760,
  "storageLimit": 52428800,
  "storagePercent": 20,
  "tier": "free",
  "billingCycleStart": "2026-02-01T00:00:00Z"
}
```

### 3. `server/authStorage.ts` (NEW)

Storage layer for user operations:
- `createUser(data: RegisterData): Promise<User>`
- `getUserByEmail(email: string): Promise<User | null>`
- `getUserByUsername(username: string): Promise<User | null>`
- `getUserById(id: string): Promise<User | null>`
- `updateUser(id: string, data: Partial<User>): Promise<User>`
- `incrementTokenUsage(id: string, tokens: number): Promise<void>`
- `resetTokenUsage(id: string): Promise<void>`

### 4. Modify `server/index.ts`

- Import and call `configurePassport(app)` before route registration
- Import and call `registerAuthRoutes(app)` in the route setup
- Add `app.use(passport.initialize())` after express.json()

### 5. Modify `server/routes.ts`

- Import `optionalAuth` middleware
- Add `optionalAuth` to document/annotation routes (don't break existing functionality)
- When `req.user` exists, scope document queries to that user's documents

### 6. Frontend: `client/src/lib/auth.ts` (NEW)

```typescript
// Auth context + hooks
// - AuthProvider component wrapping the app
// - useAuth() hook returning { user, token, login, register, logout, isLoading }
// - Token stored in localStorage
// - Auto-attach token to all fetch requests via query client default headers
```

### 7. Frontend: `client/src/pages/Login.tsx` (NEW)

- Email + password form
- Link to register
- Error handling for invalid credentials
- Redirect to `/` on success

### 8. Frontend: `client/src/pages/Register.tsx` (NEW)

- Email, username, password, confirm password form
- Link to login
- Zod validation on client side
- Redirect to `/` on success

### 9. Modify `client/src/App.tsx`

- Wrap app in `AuthProvider`
- Add `/login` and `/register` routes
- Add navigation bar with user info / login button

---

## Install Dependencies

```bash
npm install bcrypt jsonwebtoken
npm install -D @types/bcrypt @types/jsonwebtoken
```

---

## After Implementation

Run:
```bash
npm run db:push   # Sync schema changes to SQLite
npm run check     # TypeScript type check
npm run dev       # Test the dev server
```

Test manually:
1. POST `/api/auth/register` with email/username/password
2. POST `/api/auth/login` with email/password
3. GET `/api/auth/me` with Bearer token
4. Verify existing document endpoints still work without auth

---

## Important Notes

- Do NOT break existing endpoints. They must continue working without auth.
- The `optionalAuth` middleware is key — it enriches the request with user info if a token is present, but doesn't reject requests without one.
- Password must NEVER be returned in any API response. Always strip it.
- The `tier` field defaults to "free" — Stripe integration comes later.
- Token limits by tier: free=50K, pro=500K, max=2M output tokens/month.
- Storage limits by tier: free=50MB, pro=500MB, max=5GB.
