import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, JwtPayload } from '../types';

const JWT_SECRET = process.env.JWT_SECRET!;

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: '未登录，请先登录' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ success: false, error: 'Token 已过期，请重新登录' });
    } else {
      res.status(401).json({ success: false, error: 'Token 无效' });
    }
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ success: false, error: '无权限，需要管理员身份' });
      return;
    }
    next();
  });
}

export function generateTokens(payload: Omit<JwtPayload, 'iat' | 'exp'>) {
  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any,
  });

  const refreshToken = jwt.sign(
    { userId: payload.userId },
    JWT_SECRET,
    { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '30d') as any }
  );

  return { accessToken, refreshToken };
}
