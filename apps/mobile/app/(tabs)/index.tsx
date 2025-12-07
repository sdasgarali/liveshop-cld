import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { api } from '../../src/lib/api';
import { StreamCard } from '../../src/components/StreamCard';
import { CategoryList } from '../../src/components/CategoryList';

const { width } = Dimensions.get('window');

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: liveStreams,
    isLoading: loadingLive,
    refetch: refetchLive,
  } = useQuery({
    queryKey: ['streams', 'live'],
    queryFn: () => api.streams.getLive({ limit: 10 }),
  });

  const { data: upcomingStreams, refetch: refetchUpcoming } = useQuery({
    queryKey: ['streams', 'upcoming'],
    queryFn: () => api.streams.getUpcoming({ limit: 6 }),
  });

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.categories.getAll(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchLive(), refetchUpcoming()]);
    setRefreshing(false);
  }, [refetchLive, refetchUpcoming]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>LiveShop</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="search" size={24} color="#1f2937" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton}>
            <Ionicons name="cart-outline" size={24} color="#1f2937" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Categories */}
        <CategoryList categories={categories?.data || []} />

        {/* Live Now Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <View style={styles.liveDot} />
              <Text style={styles.sectionTitle}>Live Now</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/live')}>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>

          {loadingLive ? (
            <View style={styles.loadingContainer}>
              {[1, 2].map((i) => (
                <View key={i} style={styles.streamCardSkeleton} />
              ))}
            </View>
          ) : liveStreams?.data?.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="videocam-off" size={48} color="#9ca3af" />
              <Text style={styles.emptyText}>No live streams right now</Text>
            </View>
          ) : (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={liveStreams?.data}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <StreamCard stream={item} style={styles.streamCard} />
              )}
              contentContainerStyle={styles.streamList}
            />
          )}
        </View>

        {/* Upcoming Streams */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Upcoming</Text>
            <TouchableOpacity>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={upcomingStreams?.data}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <StreamCard stream={item} isUpcoming style={styles.streamCard} />
            )}
            contentContainerStyle={styles.streamList}
          />
        </View>

        {/* Featured Sellers */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Top Sellers</Text>
            <TouchableOpacity>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.sellersGrid}>
            {[1, 2, 3, 4].map((i) => (
              <TouchableOpacity key={i} style={styles.sellerCard}>
                <View style={styles.sellerAvatar}>
                  <Ionicons name="person" size={24} color="#9ca3af" />
                </View>
                <Text style={styles.sellerName}>Seller {i}</Text>
                <Text style={styles.sellerStats}>1.2k followers</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ height: 20 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  logo: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#7c3aed',
  },
  headerRight: {
    flexDirection: 'row',
    gap: 12,
  },
  iconButton: {
    padding: 8,
  },
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
  },
  seeAll: {
    fontSize: 14,
    color: '#7c3aed',
    fontWeight: '500',
  },
  streamList: {
    paddingHorizontal: 16,
    gap: 12,
  },
  streamCard: {
    width: width * 0.7,
    marginRight: 12,
  },
  loadingContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
  },
  streamCardSkeleton: {
    width: width * 0.7,
    height: 200,
    borderRadius: 12,
    backgroundColor: '#e5e7eb',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6b7280',
  },
  sellersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  sellerCard: {
    width: (width - 48) / 2,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  sellerAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  sellerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
  },
  sellerStats: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 4,
  },
});
