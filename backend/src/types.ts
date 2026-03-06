import { Request } from 'express';

export interface User {
  id: string;
  email: string;
  nickname: string | null;
  role: 'free' | 'paid' | 'admin';
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}

export type DataType = 'wrong_problems' | 'notes' | 'qbank' | 'settings';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}
