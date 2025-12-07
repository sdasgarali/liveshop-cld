import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

const client = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = await SecureStore.getItemAsync('refreshToken');
        if (refreshToken) {
          const { data } = await axios.post(`${API_URL}/api/v1/auth/refresh`, {
            refreshToken,
          });

          await SecureStore.setItemAsync('accessToken', data.data.accessToken);
          await SecureStore.setItemAsync('refreshToken', data.data.refreshToken);

          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${data.data.accessToken}`;
          }

          return client(originalRequest);
        }
      } catch (refreshError) {
        await SecureStore.deleteItemAsync('accessToken');
        await SecureStore.deleteItemAsync('refreshToken');
      }
    }

    return Promise.reject(error);
  }
);

interface PaginationParams {
  page?: number;
  limit?: number;
}

export const api = {
  auth: {
    register: (data: { email: string; username: string; password: string }) =>
      client.post('/auth/register', data).then((r) => r.data),

    login: (data: { email: string; password: string }) =>
      client.post('/auth/login', data).then((r) => r.data),

    logout: () => client.post('/auth/logout').then((r) => r.data),

    me: () => client.get('/auth/me').then((r) => r.data),
  },

  streams: {
    getLive: (params?: PaginationParams) =>
      client.get('/streams/live', { params }).then((r) => r.data),

    getUpcoming: (params?: PaginationParams) =>
      client.get('/streams/upcoming', { params }).then((r) => r.data),

    getById: (id: string) => client.get(`/streams/${id}`).then((r) => r.data),
  },

  products: {
    getAll: (params?: PaginationParams) =>
      client.get('/products', { params }).then((r) => r.data),

    getById: (id: string) => client.get(`/products/${id}`).then((r) => r.data),

    search: (query: string, params?: any) =>
      client.get('/ai/search', { params: { q: query, ...params } }).then((r) => r.data),
  },

  categories: {
    getAll: () => client.get('/categories').then((r) => r.data),
  },

  notifications: {
    getAll: (params?: PaginationParams) =>
      client.get('/notifications', { params }).then((r) => r.data),

    markAsRead: (id: string) => client.put(`/notifications/${id}/read`).then((r) => r.data),
  },
};

export default api;
