import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { Image } from 'expo-image';
import { api } from '../../src/lib/api';
import { useStreamSocket } from '../../src/lib/socket-context';
import { useAuth } from '../../src/lib/auth-context';
import { formatCurrency } from '../../src/lib/utils';

const { width, height } = Dimensions.get('window');

export default function StreamScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [bidAmount, setBidAmount] = useState('');
  const [showBidInput, setShowBidInput] = useState(false);
  const chatListRef = useRef<FlatList>(null);

  const { data: stream, isLoading } = useQuery({
    queryKey: ['stream', id],
    queryFn: () => api.streams.getById(id!),
    enabled: !!id,
  });

  const {
    isConnected,
    viewerCount,
    messages,
    currentBid,
    featuredProduct,
    sendMessage,
    placeBid,
  } = useStreamSocket(id!);

  useEffect(() => {
    if (messages.length > 0) {
      chatListRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  const handleSendMessage = () => {
    if (message.trim()) {
      sendMessage(message.trim());
      setMessage('');
    }
  };

  const handlePlaceBid = () => {
    const amount = parseFloat(bidAmount);
    if (featuredProduct && amount > 0) {
      placeBid(featuredProduct.product.id, amount);
      setBidAmount('');
      setShowBidInput(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  const streamData = stream?.data;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        {/* Video Player */}
        <View style={styles.videoContainer}>
          {streamData?.hlsUrl ? (
            <Video
              source={{ uri: streamData.hlsUrl }}
              style={styles.video}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              isLooping={false}
              useNativeControls={false}
            />
          ) : (
            <View style={styles.videoPlaceholder}>
              <Ionicons name="videocam" size={48} color="#9ca3af" />
              <Text style={styles.placeholderText}>Stream starting soon...</Text>
            </View>
          )}

          {/* Overlay Controls */}
          <View style={styles.videoOverlay}>
            <View style={styles.topOverlay}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => router.back()}
              >
                <Ionicons name="close" size={28} color="#ffffff" />
              </TouchableOpacity>

              <View style={styles.viewerBadge}>
                <Ionicons name="eye" size={14} color="#ffffff" />
                <Text style={styles.viewerCount}>{viewerCount}</Text>
              </View>

              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            </View>

            {/* Host Info */}
            <View style={styles.hostInfo}>
              <View style={styles.hostAvatar}>
                {streamData?.host?.avatarUrl ? (
                  <Image
                    source={{ uri: streamData.host.avatarUrl }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Ionicons name="person" size={20} color="#9ca3af" />
                )}
              </View>
              <View>
                <Text style={styles.hostName}>
                  {streamData?.host?.displayName || streamData?.host?.username}
                </Text>
                <Text style={styles.streamTitle} numberOfLines={1}>
                  {streamData?.title}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Featured Product */}
        {featuredProduct && (
          <View style={styles.productCard}>
            <Image
              source={{ uri: featuredProduct.product.images[0]?.url }}
              style={styles.productImage}
            />
            <View style={styles.productInfo}>
              <Text style={styles.productTitle} numberOfLines={2}>
                {featuredProduct.product.title}
              </Text>
              <Text style={styles.currentBidLabel}>Current Bid</Text>
              <Text style={styles.currentBidAmount}>
                {formatCurrency(currentBid?.currentBid || featuredProduct.startingBid || 0)}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.bidButton}
              onPress={() => setShowBidInput(true)}
            >
              <Text style={styles.bidButtonText}>BID NOW</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Chat Messages */}
        <View style={styles.chatContainer}>
          <FlatList
            ref={chatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.chatMessage}>
                <Text style={styles.chatUsername}>
                  {item.sender?.displayName || item.sender?.username}:
                </Text>
                <Text style={styles.chatContent}>{item.content}</Text>
              </View>
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.chatList}
          />
        </View>

        {/* Chat Input */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.chatInput}
            placeholder={user ? 'Say something...' : 'Sign in to chat'}
            value={message}
            onChangeText={setMessage}
            editable={!!user}
            onSubmitEditing={handleSendMessage}
          />
          <TouchableOpacity
            style={styles.sendButton}
            onPress={handleSendMessage}
            disabled={!user || !message.trim()}
          >
            <Ionicons
              name="send"
              size={20}
              color={message.trim() ? '#7c3aed' : '#9ca3af'}
            />
          </TouchableOpacity>
        </View>

        {/* Bid Input Modal */}
        {showBidInput && (
          <View style={styles.bidModal}>
            <View style={styles.bidModalContent}>
              <Text style={styles.bidModalTitle}>Place Your Bid</Text>
              <TextInput
                style={styles.bidInput}
                placeholder="Enter bid amount"
                keyboardType="decimal-pad"
                value={bidAmount}
                onChangeText={setBidAmount}
                autoFocus
              />
              <View style={styles.bidModalButtons}>
                <TouchableOpacity
                  style={styles.bidCancelButton}
                  onPress={() => setShowBidInput(false)}
                >
                  <Text style={styles.bidCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.bidSubmitButton}
                  onPress={handlePlaceBid}
                >
                  <Text style={styles.bidSubmitText}>Place Bid</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  videoContainer: {
    width: width,
    height: width * 0.5625,
    backgroundColor: '#1f2937',
  },
  video: {
    width: '100%',
    height: '100%',
  },
  videoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#9ca3af',
    marginTop: 8,
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    padding: 12,
  },
  topOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  viewerCount: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ef4444',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginLeft: 'auto',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ffffff',
  },
  liveText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  hostInfo: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hostAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  hostName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  streamTitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    maxWidth: width - 100,
  },
  productCard: {
    flexDirection: 'row',
    backgroundColor: '#1f2937',
    padding: 12,
    gap: 12,
  },
  productImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#374151',
  },
  productInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  productTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  currentBidLabel: {
    color: '#9ca3af',
    fontSize: 12,
  },
  currentBidAmount: {
    color: '#22c55e',
    fontSize: 18,
    fontWeight: '700',
  },
  bidButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignSelf: 'center',
  },
  bidButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  chatContainer: {
    flex: 1,
    backgroundColor: '#111827',
  },
  chatList: {
    padding: 12,
    gap: 8,
  },
  chatMessage: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  chatUsername: {
    color: '#7c3aed',
    fontSize: 14,
    fontWeight: '600',
  },
  chatContent: {
    color: '#ffffff',
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#1f2937',
    gap: 8,
  },
  chatInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#374151',
    borderRadius: 20,
    paddingHorizontal: 16,
    color: '#ffffff',
  },
  sendButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bidModal: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bidModalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    width: width - 48,
  },
  bidModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  bidInput: {
    height: 48,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 18,
    textAlign: 'center',
  },
  bidModalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  bidCancelButton: {
    flex: 1,
    height: 48,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bidCancelText: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '600',
  },
  bidSubmitButton: {
    flex: 1,
    height: 48,
    backgroundColor: '#22c55e',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bidSubmitText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
