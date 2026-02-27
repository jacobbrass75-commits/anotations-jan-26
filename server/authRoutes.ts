import type { Express, Request, Response } from "express";
import { registerSchema, loginSchema } from "@shared/schema";
import { requireAuth, generateToken } from "./auth";
import {
  createUser,
  getUserByEmail,
  getUserByUsername,
  getUserById,
  updateUser,
  sanitizeUser,
} from "./authStorage";
import bcrypt from "bcrypt";

export function registerAuthRoutes(app: Express): void {
  // POST /api/auth/register - Create a new account
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Validation failed",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const { email, username, password, firstName, lastName } = parsed.data;

      // Check email uniqueness
      const existingEmail = await getUserByEmail(email);
      if (existingEmail) {
        return res.status(409).json({ message: "Email already registered" });
      }

      // Check username uniqueness
      const existingUsername = await getUserByUsername(username);
      if (existingUsername) {
        return res.status(409).json({ message: "Username already taken" });
      }

      // Create user
      const user = await createUser({ email, username, password, firstName, lastName });

      // Generate JWT
      const token = generateToken(user);

      return res.status(201).json({
        user: sanitizeUser(user),
        token,
      });
    } catch (error) {
      console.error("Register error:", error);
      return res.status(500).json({ message: "Registration failed" });
    }
  });

  // POST /api/auth/login - Validate credentials and return JWT
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Validation failed",
          errors: parsed.error.flatten().fieldErrors,
        });
      }

      const { email, password } = parsed.data;

      // Find user by email
      const user = await getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Compare passwords
      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      // Generate JWT
      const token = generateToken(user);

      return res.json({
        user: sanitizeUser(user),
        token,
      });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({ message: "Login failed" });
    }
  });

  // POST /api/auth/logout - Stateless JWT, client discards token
  app.post("/api/auth/logout", requireAuth, (_req: Request, res: Response) => {
    // JWT is stateless; the client simply discards the token.
    return res.json({ message: "Logged out successfully" });
  });

  // GET /api/auth/me - Return current user profile
  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getUserById(req.user!.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      return res.json(sanitizeUser(user));
    } catch (error) {
      console.error("Get profile error:", error);
      return res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  // PUT /api/auth/me - Update profile (firstName, lastName, username)
  app.put("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const { firstName, lastName, username } = req.body;
      const updates: Record<string, any> = {};

      if (firstName !== undefined) updates.firstName = firstName;
      if (lastName !== undefined) updates.lastName = lastName;

      if (username !== undefined) {
        if (typeof username !== "string" || username.length < 3 || username.length > 30) {
          return res.status(400).json({ message: "Username must be 3-30 characters" });
        }
        // Check uniqueness
        const existing = await getUserByUsername(username);
        if (existing && existing.id !== req.user!.userId) {
          return res.status(409).json({ message: "Username already taken" });
        }
        updates.username = username;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }

      const user = await updateUser(req.user!.userId, updates);
      return res.json(sanitizeUser(user));
    } catch (error) {
      console.error("Update profile error:", error);
      return res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // GET /api/auth/usage - Return token usage, storage usage, limits
  app.get("/api/auth/usage", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getUserById(req.user!.userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const tokenPercent = user.tokenLimit > 0
        ? Math.round((user.tokensUsed / user.tokenLimit) * 100)
        : 0;
      const storagePercent = user.storageLimit > 0
        ? Math.round((user.storageUsed / user.storageLimit) * 100)
        : 0;

      return res.json({
        tokensUsed: user.tokensUsed,
        tokenLimit: user.tokenLimit,
        tokenPercent,
        storageUsed: user.storageUsed,
        storageLimit: user.storageLimit,
        storagePercent,
        tier: user.tier,
        billingCycleStart: user.billingCycleStart
          ? user.billingCycleStart.toISOString()
          : null,
      });
    } catch (error) {
      console.error("Usage error:", error);
      return res.status(500).json({ message: "Failed to fetch usage" });
    }
  });
}
