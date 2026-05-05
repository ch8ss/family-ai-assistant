import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  Animated,
  Image,
  Alert,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { sendMessage, sendMessageWithImage, transcribeAudio, getDailyTokensUsed, ChatMode } from '../lib/groq';
import { Message, Profile, Conversation } from '../lib/types';

const SLOT_COLORS = ['#7C3AED', '#EC4899', '#06B6D4'];

function TypingIndicator({ color, name }: { color: string; name: string }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - i * 150),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View style={typingStyles.row}>
      <View style={typingStyles.bubble}>
        {dots.map((dot, i) => (
          <Animated.View
            key={i}
            style={[typingStyles.dot, { backgroundColor: color, opacity: dot, transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]}
          />
        ))}
      </View>
      <Text style={typingStyles.label}>{name} is typing…</Text>
    </View>
  );
}

const typingStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  bubble: { flexDirection: 'row', gap: 5, backgroundColor: '#12121E', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { color: '#333', fontSize: 12 },
});
const DAILY_LIMIT = 50000;

export default function ChatScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= 700;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [attachedImageUri, setAttachedImageUri] = useState<string | null>(null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (profileId) bootstrap();
  }, [profileId]);

  useFocusEffect(
    React.useCallback(() => {
      if (profile && profileId) {
        supabase.from('profiles').select('*').eq('id', profileId).single()
          .then(({ data }) => { if (data) setProfile(data); });
      }
    }, [profileId, profile?.id])
  );

  useEffect(() => {
    setSidebarOpen(isWide);
  }, [isWide]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  function speakMessage(id: string, text: string) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (speakingId === id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  }

  async function bootstrap() {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', profileId)
      .single();
    if (profileData) setProfile(profileData);

    const { data: convData } = await supabase
      .from('conversations')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });

    if (convData && convData.length > 0) {
      setConversations(convData);
      await loadConversation(convData[0].id);
    } else {
      await startNewConversation(profileId);
    }

    const used = await getDailyTokensUsed();
    setTokensUsed(used);
    setLoading(false);
  }

  async function loadConversation(convId: string) {
    setActiveConvId(convId);
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    setMessages(data ?? []);
  }

  async function startNewConversation(pid?: string) {
    const profileIdToUse = pid ?? profileId;
    const { data } = await supabase
      .from('conversations')
      .insert({ profile_id: profileIdToUse, title: 'New chat' })
      .select()
      .single();
    if (data) {
      setConversations((prev) => [data, ...prev]);
      setActiveConvId(data.id);
      setMessages([]);
    }
  }

  async function pickImage() {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) { Alert.alert('Permission needed', 'Allow access to your photos to attach images.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      let base64 = asset.base64 ?? null;
      // On web, URI may be a data URL — extract base64 from it
      if (!base64 && asset.uri?.startsWith('data:')) {
        base64 = asset.uri.split(',')[1] ?? null;
      }
      // Strip data URL prefix if accidentally included
      if (base64?.includes(',')) base64 = base64.split(',')[1];
      if (!base64) { Alert.alert('Error', 'Could not read image. Try another one.'); return; }
      setAttachedImage(base64);
      setAttachedImageUri(asset.uri);
    }
  }

  async function startRecording() {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) { Alert.alert('Permission needed', 'Allow microphone access to use voice input.'); return; }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(rec);
  }

  async function stopRecording() {
    if (!recording) return;
    setTranscribing(true);
    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    const uri = recording.getURI();
    setRecording(null);
    if (uri) {
      try {
        const text = await transcribeAudio(uri);
        setInput(text);
      } catch {
        Alert.alert('Transcription failed', 'Could not convert audio to text. Try again.');
      }
    }
    setTranscribing(false);
  }

  async function fetchAllHistory(): Promise<Message[]> {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(40);
    return (data ?? []).reverse();
  }

  async function handleSend() {
    if (!input.trim() || !profile || thinking || !activeConvId) return;
    const userText = input.trim();
    setInput('');

    const optimisticMsg: Message = {
      id: Date.now().toString(),
      profile_id: profile.id,
      conversation_id: activeConvId,
      role: 'user',
      content: userText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setThinking(true);

    try {
      const context = profile.persistent_memory ? await fetchAllHistory() : messages;
      const replyText = attachedImage
        ? await sendMessageWithImage(profile, userText, attachedImage, context, null)
        : await sendMessage(profile, userText, context, null);

      const storedContent = attachedImageUri ? `[image] ${userText}`.trim() : userText;
      setAttachedImage(null);
      setAttachedImageUri(null);

      const { data: savedUser } = await supabase
        .from('messages')
        .insert({ profile_id: profile.id, conversation_id: activeConvId, role: 'user', content: storedContent })
        .select()
        .single();

      const { data: savedReply } = await supabase
        .from('messages')
        .insert({ profile_id: profile.id, conversation_id: activeConvId, role: 'assistant', content: replyText })
        .select()
        .single();

      // Update conversation title from first message
      if (messages.length === 0) {
        const title = userText.slice(0, 40) + (userText.length > 40 ? '…' : '');
        await supabase.from('conversations').update({ title }).eq('id', activeConvId);
        setConversations((prev) =>
          prev.map((c) => (c.id === activeConvId ? { ...c, title } : c))
        );
      }

      setMessages((prev) => {
        const without = prev.filter((m) => m.id !== optimisticMsg.id);
        const toAdd: Message[] = [];
        if (savedUser) toAdd.push(savedUser);
        if (savedReply) toAdd.push(savedReply);
        return [...without, ...toAdd];
      });

      const used = await getDailyTokensUsed();
      setTokensUsed(used);
    } catch (err: any) {
      setAttachedImage(null);
      setAttachedImageUri(null);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          profile_id: profile.id,
          conversation_id: activeConvId,
          role: 'assistant',
          content: err.message ?? 'Something went wrong. Try again.',
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setThinking(false);
    }
  }

  if (loading || !profile) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#7C3AED" size="large" />
      </View>
    );
  }

  const color = SLOT_COLORS[profile.slot - 1];
  const usagePct = Math.min((tokensUsed / DAILY_LIMIT) * 100, 100);

  const sidebar = (
    <View style={[styles.sidebar, isWide && styles.sidebarWide]}>
      {/* Profile header */}
      <View style={styles.sidebarHeader}>
        <TouchableOpacity onPress={() => router.push({ pathname: '/settings', params: { profileId: profile.id } })} style={styles.settingsBtn}>
            <Ionicons name="settings-outline" size={18} color="#444" />
          </TouchableOpacity>
        <TouchableOpacity onPress={() => router.replace('/')} style={styles.sidebarProfile}>
          <View style={[styles.sidebarAvatar, { backgroundColor: color }]}>
            <Text style={styles.sidebarAvatarText}>{profile.name[0].toUpperCase()}</Text>
          </View>
          <View>
            <Text style={styles.sidebarName}>{profile.name}</Text>
            <Text style={styles.sidebarAiName}>{profile.ai_name}</Text>
          </View>
        </TouchableOpacity>
        {!isWide && (
          <TouchableOpacity onPress={() => setSidebarOpen(false)}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* New chat button */}
      <TouchableOpacity
        style={[styles.newChatBtn, { borderColor: color }]}
        onPress={() => {
          startNewConversation();
          if (!isWide) setSidebarOpen(false);
        }}
      >
        <Text style={[styles.newChatText, { color }]}>+ New chat</Text>
      </TouchableOpacity>

      {/* Conversation list */}
      <FlatList
        data={conversations}
        keyExtractor={(c) => c.id}
        style={styles.convList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.convItem, item.id === activeConvId && { backgroundColor: '#1E1E2E' }]}
            onPress={() => {
              loadConversation(item.id);
              if (!isWide) setSidebarOpen(false);
            }}
          >
            <Text style={styles.convTitle} numberOfLines={1}>
              {item.title ?? 'New chat'}
            </Text>
            <Text style={styles.convDate}>
              {new Date(item.created_at).toLocaleDateString()}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Usage bar */}
      <View style={styles.usageWrap}>
        <Text style={styles.usageLabel}>Daily usage</Text>
        <View style={styles.usageTrack}>
          <View
            style={[
              styles.usageFill,
              { width: `${usagePct}%` as any, backgroundColor: usagePct > 80 ? '#EF4444' : color },
            ]}
          />
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.row}>
        {/* Sidebar — always visible on wide screens, toggled on narrow */}
        {(isWide || sidebarOpen) && sidebar}

        {/* Main chat area */}
        <View style={styles.main}>
          {/* Header */}
          <View style={styles.header}>
            {!isWide && (
              <TouchableOpacity onPress={() => setSidebarOpen(true)}>
                <Text style={styles.menuBtn}>☰</Text>
              </TouchableOpacity>
            )}
            <View style={[styles.headerDot, { backgroundColor: color }]} />
            <Text style={styles.headerName}>{profile.ai_name}</Text>
            {profile.active_mode && (
              <View style={[styles.modeBadge, { backgroundColor: color + '22', borderColor: color }]}>
                <Text style={[styles.modeBadgeText, { color }]}>
                  {profile.active_mode === 'academics' ? 'Academics' : 'Business'}
                </Text>
              </View>
            )}
          </View>

          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={styles.messageList}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Ionicons name="sparkles-outline" size={36} color="#2A2A3E" style={{ marginBottom: 16 }} />
                  <Text style={styles.emptyText}>
                    hey {profile.name}! i'm {profile.ai_name}.{'\n'}what's on your mind?
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={item.role === 'user' ? styles.bubbleUserWrap : styles.bubbleAIWrap}>
                  <View
                    style={[
                      styles.bubble,
                      item.role === 'user'
                        ? [styles.bubbleUser, { backgroundColor: color }]
                        : styles.bubbleAI,
                    ]}
                  >
                    <Text style={[styles.bubbleText, item.role === 'user' && styles.bubbleTextUser]}>
                      {item.content}
                    </Text>
                  </View>
                  {item.role === 'assistant' && (
                    <TouchableOpacity
                      style={styles.speakBtn}
                      onPress={() => speakMessage(item.id, item.content)}
                    >
                      <Ionicons
                        name={speakingId === item.id ? 'stop-circle-outline' : 'volume-medium-outline'}
                        size={15}
                        color={speakingId === item.id ? color : '#333'}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            />

            {thinking && <TypingIndicator color={color} name={profile.ai_name} />}

            {/* Image preview */}
            {attachedImageUri && (
              <View style={styles.imagePreviewWrap}>
                <Image source={{ uri: attachedImageUri }} style={styles.imagePreview} />
                <TouchableOpacity style={styles.imageRemove} onPress={() => { setAttachedImage(null); setAttachedImageUri(null); }}>
                  <Text style={styles.imageRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.inputRow}>
              {/* + image button */}
              <TouchableOpacity style={styles.iconBtn} onPress={pickImage}>
                <Text style={[styles.iconBtnText, { color: attachedImageUri ? color : '#555' }]}>+</Text>
              </TouchableOpacity>

              <TextInput
                style={styles.input}
                placeholder={recording ? 'Recording…' : transcribing ? 'Transcribing…' : `Message ${profile.ai_name}…`}
                placeholderTextColor={recording ? '#EF4444' : '#444'}
                value={input}
                onChangeText={setInput}
                multiline
                editable={!recording && !transcribing}
                onSubmitEditing={handleSend}
                onKeyPress={(e: any) => {
                  if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                    e.preventDefault?.();
                    handleSend();
                  }
                }}
              />

              {/* Mic / send button */}
              {input.trim() || attachedImageUri ? (
                <TouchableOpacity
                  style={[styles.sendBtn, { backgroundColor: color }]}
                  onPress={handleSend}
                  disabled={thinking}
                >
                  <Ionicons name="arrow-up" size={20} color="#fff" />
                </TouchableOpacity>
              ) : transcribing ? (
                <View style={[styles.sendBtn, { backgroundColor: '#1E1E2E' }]}>
                  <ActivityIndicator color={color} size="small" />
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.sendBtn, { backgroundColor: recording ? '#EF4444' : '#1E1E2E' }]}
                  onPress={recording ? stopRecording : startRecording}
                >
                  <Ionicons name={recording ? 'stop' : 'mic'} size={18} color={recording ? '#fff' : '#555'} />
                </TouchableOpacity>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A' },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flex: 1, flexDirection: 'row' },

  // Sidebar
  sidebar: {
    width: '100%',
    backgroundColor: '#0A0A14',
    borderRightWidth: 1,
    borderRightColor: '#1E1E2E',
    position: 'absolute',
    top: 0, left: 0, bottom: 0,
    zIndex: 10,
  },
  sidebarWide: { position: 'relative', width: 260 },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E2E',
  },
  sidebarProfile: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sidebarAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarAvatarText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sidebarName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  sidebarAiName: { color: '#555', fontSize: 12 },
  closeBtn: { color: '#555', fontSize: 18, padding: 4 },
  settingsBtn: { padding: 4 },
  modeBadge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  modeBadgeText: { fontSize: 11, fontWeight: '700' },

  newChatBtn: {
    margin: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  newChatText: { fontSize: 14, fontWeight: '600' },

  modesSection: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1A1A2A' },
  modesTitle: { color: '#333', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 },
  modesRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#1E1E2E', backgroundColor: '#0A0A14' },
  modeChipText: { color: '#444', fontSize: 12, fontWeight: '600' },
  convList: { flex: 1 },
  convItem: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, marginHorizontal: 8, marginVertical: 2 },
  convTitle: { color: '#ccc', fontSize: 13, fontWeight: '500' },
  convDate: { color: '#444', fontSize: 11, marginTop: 2 },

  usageWrap: { padding: 16, borderTopWidth: 1, borderTopColor: '#1E1E2E' },
  usageLabel: { color: '#444', fontSize: 11, marginBottom: 6 },
  usageTrack: { height: 4, backgroundColor: '#1E1E2E', borderRadius: 2, overflow: 'hidden' },
  usageFill: { height: 4, borderRadius: 2 },

  // Main
  main: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E2E',
    gap: 10,
  },
  menuBtn: { color: '#666', fontSize: 20, marginRight: 4 },
  headerDot: { width: 10, height: 10, borderRadius: 5 },
  headerName: { color: '#fff', fontSize: 16, fontWeight: '600' },

  messageList: { padding: 16, gap: 8, flexGrow: 1, justifyContent: 'flex-end' },
  bubbleUserWrap: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleAIWrap: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  speakBtn: { marginTop: 4, marginLeft: 4, padding: 2 },
  bubble: {
    maxWidth: '82%',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginVertical: 2,
  },
  bubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  bubbleAI: { alignSelf: 'flex-start', backgroundColor: '#12121E', borderBottomLeftRadius: 6, borderWidth: 1, borderColor: '#1E1E2E' },
  bubbleText: { color: '#bbb', fontSize: 15, lineHeight: 23 },
  bubbleTextUser: { color: '#fff' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { color: '#333', fontSize: 16, textAlign: 'center', paddingHorizontal: 32, lineHeight: 26 },
  imagePreviewWrap: { marginHorizontal: 12, marginBottom: 8, position: 'relative', alignSelf: 'flex-start' },
  imagePreview: { width: 80, height: 80, borderRadius: 12 },
  imageRemove: {
    position: 'absolute', top: -6, right: -6,
    backgroundColor: '#EF4444', borderRadius: 10, width: 20, height: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  imageRemoveText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { fontSize: 28, fontWeight: '300', lineHeight: 32 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: '#1E1E2E',
  },
  input: {
    flex: 1,
    backgroundColor: '#1E1E2E',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
