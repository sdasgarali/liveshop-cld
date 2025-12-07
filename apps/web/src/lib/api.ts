import axios, { AxiosError, AxiosRequestConfig } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const client = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
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
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          const { data } = await axios.post(`${API_URL}/api/v1/auth/refresh`, {
            refreshToken,
          });

          localStorage.setItem('accessToken', data.data.accessToken);
          localStorage.setItem('refreshToken', data.data.refreshToken);

          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${data.data.accessToken}`;
          }

          return client(originalRequest);
        }
      } catch (refreshError) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        window.location.href = '/login';
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
    register: (data: { email: string; username: string; password: string; firstName?: string; lastName?: string }) =>
      client.post('/auth/register', data).then((r) => r.data),

    login: (data: { email: string; password: string }) =>
      client.post('/auth/login', data).then((r) => r.data),

    logout: () => client.post('/auth/logout').then((r) => r.data),

    me: () => client.get('/auth/me').then((r) => r.data),

    refresh: (refreshToken: string) =>
      client.post('/auth/refresh', { refreshToken }).then((r) => r.data),
  },

  users: {
    getProfile: (username: string) => client.get(`/users/${username}`).then((r) => r.data),

    updateProfile: (data: any) => client.put('/users/profile', data).then((r) => r.data),

    follow: (userId: string) => client.put(`/users/${userId}/follow`).then((r) => r.data),

    unfollow: (userId: string) => client.put(`/users/${userId}/unfollow`).then((r) => r.data),

    getFollowers: (userId: string, params?: PaginationParams) =>
      client.get(`/users/${userId}/followers`, { params }).then((r) => r.data),

    getFollowing: (userId: string, params?: PaginationParams) =>
      client.get(`/users/${userId}/following`, { params }).then((r) => r.data),
  },

  streams: {
    getLive: (params?: PaginationParams & { categoryId?: string }) =>
      client.get('/streams/live', { params }).then((r) => r.data),

    getUpcoming: (params?: PaginationParams) =>
      client.get('/streams/upcoming', { params }).then((r) => r.data),

    getById: (id: string) => client.get(`/streams/${id}`).then((r) => r.data),

    create: (data: { title: string; description?: string; scheduledAt?: string }) =>
      client.post('/streams', data).then((r) => r.data),

    update: (id: string, data: any) => client.put(`/streams/${id}`, data).then((r) => r.data),

    goLive: (id: string) => client.post(`/streams/${id}/go-live`).then((r) => r.data),

    end: (id: string) => client.post(`/streams/${id}/end`).then((r) => r.data),

    getStreamKey: (id: string) => client.get(`/streams/${id}/stream-key`).then((r) => r.data),

    addProduct: (streamId: string, data: { productId: string; startingBid?: number }) =>
      client.post(`/streams/${streamId}/products`, data).then((r) => r.data),
  },

  products: {
    getAll: (params?: PaginationParams & { categoryId?: string; status?: string }) =>
      client.get('/products', { params }).then((r) => r.data),

    getTrending: (params?: PaginationParams) =>
      client.get('/products/trending', { params }).then((r) => r.data),

    getById: (id: string) => client.get(`/products/${id}`).then((r) => r.data),

    create: (data: any) => client.post('/products', data).then((r) => r.data),

    update: (id: string, data: any) => client.put(`/products/${id}`, data).then((r) => r.data),

    search: (query: string, params?: any) =>
      client.get('/ai/search', { params: { q: query, ...params } }).then((r) => r.data),

    getSimilar: (id: string) => client.get(`/ai/similar/${id}`).then((r) => r.data),
  },

  orders: {
    getAll: (params?: PaginationParams) =>
      client.get('/orders', { params }).then((r) => r.data),

    getById: (id: string) => client.get(`/orders/${id}`).then((r) => r.data),

    create: (data: any) => client.post('/orders', data).then((r) => r.data),
  },

  bids: {
    place: (data: { productId: string; streamId?: string; amount: number }) =>
      client.post('/bids', data).then((r) => r.data),

    getForProduct: (productId: string) =>
      client.get(`/bids/product/${productId}`).then((r) => r.data),
  },

  ai: {
    generateListing: (data: { imageUrls?: string[]; rawDescription?: string; category?: string; condition?: string }) =>
      client.post('/ai/generate-listing', data).then((r) => r.data),

    suggestPrice: (data: { title: string; description: string; condition: string }) =>
      client.post('/ai/suggest-price', data).then((r) => r.data),

    getSellerInsights: () => client.get('/ai/seller-insights').then((r) => r.data),

    chatWithAssistant: (message: string, conversationId?: string) =>
      client.post('/ai/assistant/chat', { message, conversationId }).then((r) => r.data),
  },

  categories: {
    getAll: () => client.get('/categories').then((r) => r.data),

    getById: (id: string) => client.get(`/categories/${id}`).then((r) => r.data),
  },

  notifications: {
    getAll: (params?: PaginationParams) =>
      client.get('/notifications', { params }).then((r) => r.data),

    markAsRead: (id: string) => client.put(`/notifications/${id}/read`).then((r) => r.data),

    markAllAsRead: () => client.put('/notifications/read-all').then((r) => r.data),
  },

  uploads: {
    uploadImage: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return client.post('/uploads/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    },
  },
};

export default api;
