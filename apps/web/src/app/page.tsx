'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Header } from '@/components/layout/header';
import { StreamCard } from '@/components/streams/stream-card';
import { CategoryNav } from '@/components/navigation/category-nav';
import { ProductGrid } from '@/components/products/product-grid';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { PlayCircle, Clock, TrendingUp, Sparkles } from 'lucide-react';

export default function HomePage() {
  const [activeTab, setActiveTab] = useState('live');

  const { data: liveStreams, isLoading: loadingLive } = useQuery({
    queryKey: ['streams', 'live'],
    queryFn: () => api.streams.getLive({ limit: 12 }),
  });

  const { data: upcomingStreams, isLoading: loadingUpcoming } = useQuery({
    queryKey: ['streams', 'upcoming'],
    queryFn: () => api.streams.getUpcoming({ limit: 8 }),
  });

  const { data: trendingProducts } = useQuery({
    queryKey: ['products', 'trending'],
    queryFn: () => api.products.getTrending({ limit: 12 }),
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />

      {/* Hero Section */}
      <section className="relative bg-gradient-to-r from-primary/20 via-primary/10 to-background py-12 px-4">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="max-w-xl">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">
                Shop Live, Win Big
              </h1>
              <p className="text-lg text-muted-foreground mb-6">
                Join live auctions, discover unique items, and connect with sellers in real-time.
                Experience the thrill of live shopping.
              </p>
              <div className="flex gap-4">
                <Button size="lg" asChild>
                  <Link href="/streams">
                    <PlayCircle className="mr-2 h-5 w-5" />
                    Watch Live
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/sell">Start Selling</Link>
                </Button>
              </div>
            </div>
            <div className="hidden md:block w-96 h-64 bg-gradient-to-br from-primary to-purple-600 rounded-2xl" />
          </div>
        </div>
      </section>

      {/* Category Navigation */}
      <CategoryNav />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-8">
          <TabsList className="mb-6">
            <TabsTrigger value="live" className="gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              Live Now
            </TabsTrigger>
            <TabsTrigger value="upcoming" className="gap-2">
              <Clock className="h-4 w-4" />
              Upcoming
            </TabsTrigger>
            <TabsTrigger value="trending" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              Trending
            </TabsTrigger>
            <TabsTrigger value="foryou" className="gap-2">
              <Sparkles className="h-4 w-4" />
              For You
            </TabsTrigger>
          </TabsList>

          <TabsContent value="live">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold">Live Streams</h2>
              <span className="text-sm text-muted-foreground">
                {liveStreams?.data?.length || 0} live now
              </span>
            </div>
            {loadingLive ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="aspect-video bg-muted animate-pulse rounded-xl" />
                ))}
              </div>
            ) : liveStreams?.data?.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-4">No live streams right now</p>
                <Button variant="outline" asChild>
                  <Link href="/streams/upcoming">Check Upcoming</Link>
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {liveStreams?.data?.map((stream: any) => (
                  <StreamCard key={stream.id} stream={stream} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="upcoming">
            <div className="mb-4">
              <h2 className="text-2xl font-bold">Upcoming Streams</h2>
            </div>
            {loadingUpcoming ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="aspect-video bg-muted animate-pulse rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {upcomingStreams?.data?.map((stream: any) => (
                  <StreamCard key={stream.id} stream={stream} isUpcoming />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="trending">
            <div className="mb-4">
              <h2 className="text-2xl font-bold">Trending Products</h2>
            </div>
            <ProductGrid products={trendingProducts?.data || []} />
          </TabsContent>

          <TabsContent value="foryou">
            <div className="mb-4">
              <h2 className="text-2xl font-bold">Recommended For You</h2>
            </div>
            <p className="text-muted-foreground">
              Sign in to get personalized recommendations
            </p>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
