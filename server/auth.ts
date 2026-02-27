import type { Express, Request, Response, NextFunction } from "express";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { getUserByEmail, getUserById } from "./authStorage";
import type { User } from "@shared/schema";

// Extend Express Request to include user property
declare global {
  namespace Express {
    interface User {
      userId: string;
      email: string;
      tier: string;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || "dev-jwt-secret-change-in-production-64chars-long-string-placeholder!!";
const JWT_EXPIRY = "7d";

export interface JwtPayload {
  userId: string;
  email: string;
  tier: string;
  iat: number;
  exp: number;
}

/** Configure Passport with local strategy */
export function configurePassport(app: Express): void {
  app.use(passport.initialize());

  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      async (email, password, done) => {
        try {
          const user = await getUserByEmail(email);
          if (!user) {
            return done(null, false, { message: "Invalid email or password" });
          }

          const isValid = await bcrypt.compare(password, user.password);
          if (!isValid) {
            return done(null, false, { message: "Invalid email or password" });
          }

          return done(null, { userId: user.id, email: user.email, tier: user.tier });
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

/** Generate a JWT for a user */
export function generateToken(user: User): string {
  return jwt.sign(
    { userId: user.id, email: user.email, tier: user.tier },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/** Verify and decode a JWT */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/** Extract Bearer token from Authorization header */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

/** Middleware: requires a valid JWT. Rejects with 401 if missing or invalid. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }

  req.user = { userId: payload.userId, email: payload.email, tier: payload.tier };
  next();
}

/** Middleware: attaches user info if token present, but does NOT reject if missing. */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = { userId: payload.userId, email: payload.email, tier: payload.tier };
    }
  }
  next();
}
