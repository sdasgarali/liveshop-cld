'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './auth-context';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  joinStream: (streamId: string) => void;
  leaveStream: (streamId: string) => void;
  sendMessage: (streamId: string, content: string) => void;
  placeBid: (streamId: string, productId: string, amount: number) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    const token = localStorage.getItem('accessToken');

    const newSocket = io(`${WS_URL}/stream`, {
      autoConnect: false,
      auth: token ? { token } : undefined,
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      console.log('Socket connected');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected');
      setIsConnected(false);
    });

    newSocket.on('error', (error) => {
      console.error('Socket error:', error);
    });

    newSocket.connect();
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [isAuthenticated]);

  const joinStream = useCallback(
    (streamId: string) => {
      if (socket) {
        socket.emit('join-stream', { streamId });
      }
    },
    [socket]
  );

  const leaveStream = useCallback(
    (streamId: string) => {
      if (socket) {
        socket.emit('leave-stream', streamId);
      }
    },
    [socket]
  );

  const sendMessage = useCallback(
    (streamId: string, content: string) => {
      if (socket) {
        socket.emit('send-message', { streamId, content });
      }
    },
    [socket]
  );

  const placeBid = useCallback(
    (streamId: string, productId: string, amount: number) => {
      if (socket) {
        socket.emit('place-bid', { streamId, productId, amount });
      }
    },
    [socket]
  );

  return (
    <SocketContext.Provider
      value={{
        socket,
        isConnected,
        joinStream,
        leaveStream,
        sendMessage,
        placeBid,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
}

export function useStreamSocket(streamId: string) {
  const { socket, joinStream, leaveStream, sendMessage, placeBid, isConnected } = useSocket();
  const [viewerCount, setViewerCount] = useState(0);
  const [messages, setMessages] = useState<any[]>([]);
  const [currentBid, setCurrentBid] = useState<any>(null);
  const [featuredProduct, setFeaturedProduct] = useState<any>(null);

  useEffect(() => {
    if (!socket || !streamId) return;

    joinStream(streamId);

    socket.on('viewer-count', (data: { count: number }) => {
      setViewerCount(data.count);
    });

    socket.on('new-message', (message: any) => {
      setMessages((prev) => [...prev, message]);
    });

    socket.on('new-bid', (bid: any) => {
      setCurrentBid(bid);
    });

    socket.on('product-featured', (product: any) => {
      setFeaturedProduct(product);
    });

    socket.on('product-sold', (data: any) => {
      console.log('Product sold:', data);
    });

    return () => {
      leaveStream(streamId);
      socket.off('viewer-count');
      socket.off('new-message');
      socket.off('new-bid');
      socket.off('product-featured');
      socket.off('product-sold');
    };
  }, [socket, streamId, joinStream, leaveStream]);

  const send = useCallback(
    (content: string) => {
      sendMessage(streamId, content);
    },
    [streamId, sendMessage]
  );

  const bid = useCallback(
    (productId: string, amount: number) => {
      placeBid(streamId, productId, amount);
    },
    [streamId, placeBid]
  );

  return {
    isConnected,
    viewerCount,
    messages,
    currentBid,
    featuredProduct,
    sendMessage: send,
    placeBid: bid,
  };
}
