import { apiRequest } from './api';

export interface AuthUser {
  id: string;
  email: string;
  nickname: string;
  role: 'admin' | 'user';
  createdAt: string;
}

interface UserResponse {
  user: AuthUser;
}

export interface RegisterInput {
  email: string;
  password: string;
  nickname?: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export const authApi = {
  async me() {
    const result = await apiRequest<UserResponse>('/api/v1/auth/me');
    return result.user;
  },

  async login(email: string, password: string) {
    const result = await apiRequest<UserResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return result.user;
  },

  async register(input: RegisterInput) {
    const result = await apiRequest<UserResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.user;
  },

  logout() {
    return apiRequest<void>('/api/v1/auth/logout', { method: 'POST' });
  },

  changePassword(input: ChangePasswordInput) {
    return apiRequest<{ ok: true }>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
};
