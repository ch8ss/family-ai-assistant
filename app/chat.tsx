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
  ScrollView,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { sendMessage, sendMessageWithImage, transcribeAudio, getDailyTokensUsed, ChatMode, Source } from '../lib/groq';
import { Message, Profile, Conversation } from '../lib/types';

const SLOT_COLORS = ['#8B5CF6', '#EC4899', '#06B6D4'];
const DAILY_LIMIT = 50000;

function TypingIndicator({ color, name }: { color: string; name: string }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 150),
        Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.delay(600 - i * 150),
      ]))
    );
    anims.forEach(a => a.start());
    return () => anims.forEach(a => a.stop());
  }, []);
  return (
    <View style={typingStyles.row}>
      <View style={typingStyles.bubble}>
        {dots.map((dot, i) => (
          <Animated.View key={i} style={[typingStyles.dot, { backgroundColor: color, opacity: dot, transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }]} />
        ))}
      </View>
      <Text style={typingStyles.label}>{name} is typing…</Text>
    </View>
  );
}

const typingStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  bubble: { flexDirection: 'row', gap: 5, backgroundColor: '#161625', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { color: '#444', fontSize: 12 },
});


function getTimeGroup(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Previous 7 days';
  return 'Older';
}

type ConvListItem = Conversation | { _header: true; label: string; id: string };

function groupConversations(convs: Conversation[]): ConvListItem[] {
  const order = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];
  const map: Record<string, Conversation[]> = {};
  convs.forEach(c => {
    const g = getTimeGroup(c.created_at);
    if (!map[g]) map[g] = [];
    map[g].push(c);
  });
  const result: ConvListItem[] = [];
  order.forEach(label => {
    if (map[label]?.length) {
      result.push({ _header: true, label, id: `header-${label}` });
      result.push(...map[label]);
    }
  });
  return result;
}

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
  const [hoveredConvId, setHoveredConvId] = useState<string | null>(null);
  const [sourcesMap, setSourcesMap] = useState<Record<string, Source[]>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => { if (profileId) bootstrap(); }, [profileId]);

  useFocusEffect(React.useCallback(() => {
    if (profile && profileId) {
      supabase.from('profiles').select('*').eq('id', profileId).single()
        .then(({ data }) => { if (data) setProfile(data); });
    }
  }, [profileId, profile?.id]));

  useEffect(() => { setSidebarOpen(isWide); }, [isWide]);

  useEffect(() => {
    if (messages.length > 0) setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages]);

  function speakMessage(id: string, text: string) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (speakingId === id) { window.speechSynthesis.cancel(); setSpeakingId(null); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05; utterance.pitch = 1.0; utterance.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred = profile?.voice_preference
      ? voices.find(v => v.name === profile.voice_preference)
      : voices.find(v => v.name.includes('Alex') || v.name.includes('Samantha') || v.name.includes('Google US English') || v.name.includes('Karen'))
        || voices.find(v => v.lang.startsWith('en') && v.localService) || voices[0];
    if (preferred) utterance.voice = preferred;
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  }

  function copyText(id: string, text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function bootstrap() {
    const { data: profileData } = await supabase.from('profiles').select('*').eq('id', profileId).single();
    if (profileData) setProfile(profileData);
    const { data: convData } = await supabase.from('conversations').select('*').eq('profile_id', profileId).order('created_at', { ascending: false });
    if (convData) setConversations(convData);
    setActiveConvId(null);
    setMessages([]);
    const used = await getDailyTokensUsed();
    setTokensUsed(used);
    setLoading(false);
  }

  async function loadConversation(convId: string) {
    setActiveConvId(convId);
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: true });
    setMessages(data ?? []);
  }

  async function startNewConversation(pid?: string) {
    const profileIdToUse = pid ?? profileId;
    const { data } = await supabase.from('conversations').insert({ profile_id: profileIdToUse, title: 'New chat' }).select().single();
    if (data) { setConversations(prev => [data, ...prev]); setActiveConvId(data.id); setMessages([]); }
  }

  async function pickImage() {
    const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!granted) { Alert.alert('Permission needed', 'Allow access to your photos to attach images.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, base64: true });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      let base64 = asset.base64 ?? null;
      if (!base64 && asset.uri?.startsWith('data:')) base64 = asset.uri.split(',')[1] ?? null;
      if (base64?.includes(',')) base64 = base64.split(',')[1];
      if (!base64) { Alert.alert('Error', 'Could not read image. Try another one.'); return; }
      setAttachedImage(base64); setAttachedImageUri(asset.uri);
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
      try { const text = await transcribeAudio(uri); setInput(text); }
      catch { Alert.alert('Transcription failed', 'Could not convert audio to text. Try again.'); }
    }
    setTranscribing(false);
  }

  async function deleteConversation(convId: string) {
    const doDelete = async () => {
      await supabase.from('conversations').delete().eq('id', convId);
      const remaining = conversations.filter(c => c.id !== convId);
      setConversations(remaining);
      if (activeConvId === convId) {
        if (remaining.length > 0) await loadConversation(remaining[0].id);
        else { setActiveConvId(null); setMessages([]); }
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this conversation?')) await doDelete();
    } else {
      Alert.alert('Delete chat', 'This will permanently delete this conversation.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  }

  async function fetchAllHistory(): Promise<Message[]> {
    const { data } = await supabase.from('messages').select('*').eq('profile_id', profileId).order('created_at', { ascending: false }).limit(40);
    return (data ?? []).reverse();
  }

  async function handleSend() {
    if (!input.trim() || !profile || thinking) return;
    const userText = input.trim();
    setInput('');

    let convId = activeConvId;
    if (!convId) {
      const { data } = await supabase.from('conversations').insert({ profile_id: profile.id, title: 'New chat' }).select().single();
      if (!data) return;
      convId = data.id;
      setActiveConvId(data.id);
      setConversations(prev => [data, ...prev]);
    }

    const optimisticMsg: Message = { id: Date.now().toString(), profile_id: profile.id, conversation_id: convId, role: 'user', content: userText, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, optimisticMsg]);
    setThinking(true);
    try {
      const context = profile.persistent_memory ? await fetchAllHistory() : messages;
      const result = attachedImage
        ? await sendMessageWithImage(profile, userText, attachedImage, context, null)
        : await sendMessage(profile, userText, context, null);
      const replyText = result.content;
      const replySources = result.sources;
      const storedContent = attachedImageUri ? `[image] ${userText}`.trim() : userText;
      setAttachedImage(null); setAttachedImageUri(null);
      const { data: savedUser } = await supabase.from('messages').insert({ profile_id: profile.id, conversation_id: convId, role: 'user', content: storedContent }).select().single();
      const { data: savedReply } = await supabase.from('messages').insert({ profile_id: profile.id, conversation_id: convId, role: 'assistant', content: replyText }).select().single();
      if (savedReply && replySources.length > 0) {
        setSourcesMap(prev => ({ ...prev, [savedReply.id]: replySources }));
      }
      if (messages.length === 0) {
        const title = userText.slice(0, 40) + (userText.length > 40 ? '…' : '');
        await supabase.from('conversations').update({ title }).eq('id', convId);
        setConversations(prev => prev.map(c => c.id === convId ? { ...c, title } : c));
      }
      setMessages(prev => {
        const without = prev.filter(m => m.id !== optimisticMsg.id);
        const toAdd: Message[] = [];
        if (savedUser) toAdd.push(savedUser);
        if (savedReply) toAdd.push(savedReply);
        return [...without, ...toAdd];
      });
      const used = await getDailyTokensUsed();
      setTokensUsed(used);
    } catch (err: any) {
      setAttachedImage(null); setAttachedImageUri(null);
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      setMessages(prev => [...prev, { id: Date.now().toString(), profile_id: profile.id, conversation_id: convId, role: 'assistant', content: err.message ?? 'Something went wrong. Try again.', created_at: new Date().toISOString() }]);
    } finally {
      setThinking(false);
    }
  }

  if (loading || !profile) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color="#8B5CF6" size="large" /></View>;
  }

  const color = SLOT_COLORS[profile.slot - 1];
  const usagePct = Math.min((tokensUsed / DAILY_LIMIT) * 100, 100);
  const grouped = groupConversations(conversations);

  const modeLabel = profile.active_mode === 'academics' ? 'Academics mode' : profile.active_mode === 'business' ? 'Business mode' : 'AI companion';

  const sidebar = (
    <View style={[styles.sidebar, isWide && styles.sidebarWide]}>
      {/* Profile header */}
      <View style={styles.sidebarHeader}>
        <TouchableOpacity onPress={() => router.replace('/')} style={styles.sidebarProfile}>
          <View style={[styles.sidebarAvatar, { backgroundColor: color }]}>
            <Text style={styles.sidebarAvatarText}>{profile.name[0].toUpperCase()}</Text>
          </View>
          <View>
            <Text style={styles.sidebarName}>{profile.name}</Text>
            <Text style={styles.sidebarAiName}>with {profile.ai_name}</Text>
          </View>
        </TouchableOpacity>
        {!isWide && (
          <TouchableOpacity onPress={() => setSidebarOpen(false)} style={{ padding: 4 }}>
            <Ionicons name="close" size={20} color="#555" />
          </TouchableOpacity>
        )}
      </View>

      {/* New chat */}
      <TouchableOpacity
        style={[styles.newChatBtn, { borderColor: color }]}
        onPress={() => { setActiveConvId(null); setMessages([]); if (!isWide) setSidebarOpen(false); }}
      >
        <Text style={[styles.newChatText, { color }]}>+ New chat</Text>
      </TouchableOpacity>

      {/* Grouped conversation list */}
      <FlatList
        data={grouped}
        keyExtractor={item => ('_header' in item ? item.id : item.id)}
        style={styles.convList}
        renderItem={({ item }) => {
          if ('_header' in item) {
            return <Text style={styles.convGroupLabel}>{item.label}</Text>;
          }
          const isHovered = hoveredConvId === item.id;
          const isActive = item.id === activeConvId;
          return (
            <View
              style={[styles.convItem, isActive && styles.convItemActive, isHovered && !isActive && styles.convItemHovered]}
              // @ts-ignore
              onMouseEnter={() => setHoveredConvId(item.id)}
              onMouseLeave={() => setHoveredConvId(null)}
            >
              <TouchableOpacity
                style={styles.convRow}
                onPress={() => { loadConversation(item.id); if (!isWide) setSidebarOpen(false); }}
                onLongPress={() => deleteConversation(item.id)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.convTitle, isActive && { color: '#fff' }]} numberOfLines={1}>{item.title ?? 'New chat'}</Text>
                  <Text style={styles.convDate}>{new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Text>
                </View>
              </TouchableOpacity>
              {isHovered && (
                <TouchableOpacity onPress={() => deleteConversation(item.id)} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={14} color="#EF4444" />
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />

      {/* Settings + usage footer */}
      <View style={styles.sidebarFooter}>
        <TouchableOpacity
          style={styles.settingsRow}
          onPress={() => router.push({ pathname: '/settings', params: { profileId: profile.id } })}
        >
          <Ionicons name="settings-outline" size={16} color="#555" />
          <Text style={styles.settingsLabel}>Settings</Text>
        </TouchableOpacity>
        <View style={styles.usageWrap}>
          <View style={styles.usageTopRow}>
            <Text style={styles.usageLabel}>Daily usage</Text>
            <Text style={styles.usageCount}>{tokensUsed.toLocaleString()} / 50,000 tokens</Text>
          </View>
          <View style={styles.usageTrack}>
            <View style={[styles.usageFill, { width: `${usagePct}%` as any, backgroundColor: usagePct > 80 ? '#EF4444' : color }]} />
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.row}>
        {(isWide || sidebarOpen) && sidebar}

        <View style={styles.main}>
          {/* Header */}
          <View style={styles.header}>
            {!isWide && (
              <TouchableOpacity onPress={() => setSidebarOpen(true)} style={{ marginRight: 8 }}>
                <Ionicons name="menu-outline" size={22} color="#666" />
              </TouchableOpacity>
            )}
            <View style={[styles.headerAvatar, { backgroundColor: color }]}>
              <Text style={styles.headerAvatarText}>{profile.ai_name[0].toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerName}>{profile.ai_name}</Text>
              <Text style={[styles.headerSub, profile.active_mode && { color }]}>{modeLabel}</Text>
            </View>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={m => m.id}
              style={{ flex: 1 }}
              contentContainerStyle={styles.messageList}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Ionicons name="sparkles-outline" size={36} color="#2A2A3E" style={{ marginBottom: 16 }} />
                  <Text style={styles.emptyText}>hey {profile.name}! i'm {profile.ai_name}.{'\n'}what's on your mind?</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={item.role === 'user' ? styles.bubbleUserWrap : styles.bubbleAIWrap}>
                  <View style={[styles.bubble, item.role === 'user' ? [styles.bubbleUser, { backgroundColor: color }] : styles.bubbleAI]}>
                    <Text style={[styles.bubbleText, item.role === 'user' && styles.bubbleTextUser]}>{item.content}</Text>
                  </View>
                  {item.role === 'assistant' && (
                    <View style={styles.messageActions}>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => speakMessage(item.id, item.content)}>
                        <Ionicons name={speakingId === item.id ? 'stop-circle-outline' : 'volume-medium-outline'} size={14} color={speakingId === item.id ? color : '#444'} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => copyText(item.id, item.content)}>
                        <Ionicons name={copiedId === item.id ? 'checkmark' : 'copy-outline'} size={14} color={copiedId === item.id ? color : '#444'} />
                      </TouchableOpacity>
                    </View>
                  )}

                  {item.role === 'assistant' && sourcesMap[item.id]?.length > 0 && (
                    <View style={styles.sourcesWrap}>
                      <Ionicons name="globe-outline" size={11} color="#444" style={{ marginRight: 4 }} />
                      {sourcesMap[item.id].map((s, i) => (
                        <TouchableOpacity
                          key={i}
                          style={styles.sourceChip}
                          onPress={() => { if (typeof window !== 'undefined') window.open(s.url, '_blank'); }}
                        >
                          <Text style={styles.sourceChipText} numberOfLines={1}>{s.title}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              )}
            />

            {thinking && <TypingIndicator color={color} name={profile.ai_name} />}

            {attachedImageUri && (
              <View style={styles.imagePreviewWrap}>
                <Image source={{ uri: attachedImageUri }} style={styles.imagePreview} />
                <TouchableOpacity style={styles.imageRemove} onPress={() => { setAttachedImage(null); setAttachedImageUri(null); }}>
                  <Text style={styles.imageRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.inputRow}>
              <TouchableOpacity style={styles.iconBtn} onPress={pickImage}>
                <Text style={[styles.iconBtnText, { color: attachedImageUri ? color : '#555' }]}>+</Text>
              </TouchableOpacity>
              <TextInput
                style={[styles.input, { outlineWidth: 0 } as any]}
                placeholder={recording ? 'Recording…' : transcribing ? 'Transcribing…' : `Message ${profile.ai_name}…`}
                placeholderTextColor={recording ? '#EF4444' : '#555'}
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
              {input.trim() || attachedImageUri ? (
                <TouchableOpacity style={[styles.sendBtn, { backgroundColor: color }]} onPress={handleSend} disabled={thinking}>
                  <Ionicons name="arrow-up" size={20} color="#fff" />
                </TouchableOpacity>
              ) : transcribing ? (
                <View style={[styles.sendBtn, { backgroundColor: '#1A1A2E' }]}>
                  <ActivityIndicator color={color} size="small" />
                </View>
              ) : (
                <TouchableOpacity style={[styles.sendBtn, { backgroundColor: recording ? '#EF4444' : '#1A1A2E' }]} onPress={recording ? stopRecording : startRecording}>
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

  sidebar: { width: '100%', backgroundColor: '#0A0A14', borderRightWidth: 1, borderRightColor: '#1A1A2A', position: 'absolute', top: 0, left: 0, bottom: 0, zIndex: 10, flexDirection: 'column' },
  sidebarWide: { position: 'relative', width: 260 },
  sidebarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 20, borderBottomWidth: 1, borderBottomColor: '#1A1A2A' },
  sidebarProfile: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sidebarAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sidebarAvatarText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  sidebarName: { color: '#ddd', fontSize: 14, fontWeight: '600' },
  sidebarAiName: { color: '#555', fontSize: 12, marginTop: 1 },

  newChatBtn: { margin: 12, padding: 10, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  newChatText: { fontSize: 14, fontWeight: '600' },

  convList: { flex: 1 },
  convGroupLabel: { color: '#3A3A5A', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  convItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginHorizontal: 8, marginVertical: 1 },
  convItemActive: { backgroundColor: '#1E1E30' },
  convItemHovered: { backgroundColor: '#141422' },
  convRow: { flex: 1 },
  convTitle: { color: '#aaa', fontSize: 13, fontWeight: '500' },
  convDate: { color: '#555', fontSize: 11, marginTop: 2 },
  deleteBtn: { padding: 4 },

  sidebarFooter: { borderTopWidth: 1, borderTopColor: '#1A1A2A' },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  settingsLabel: { color: '#555', fontSize: 13 },
  usageWrap: { paddingHorizontal: 16, paddingBottom: 16 },
  usageTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  usageLabel: { color: '#555', fontSize: 11 },
  usageCount: { color: '#444', fontSize: 10 },
  usageTrack: { height: 3, backgroundColor: '#1E1E2E', borderRadius: 2, overflow: 'hidden' },
  usageFill: { height: 3, borderRadius: 2 },

  main: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1A1A2A', gap: 12 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  headerAvatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  headerName: { color: '#fff', fontSize: 16, fontWeight: '700', fontFamily: 'Inter, system-ui, -apple-system, sans-serif' },
  headerSub: { color: '#555', fontSize: 12, marginTop: 1, fontFamily: 'Inter, system-ui, -apple-system, sans-serif' },

  messageList: { padding: 16, gap: 8, flexGrow: 1, justifyContent: 'flex-end' },
  bubbleUserWrap: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleAIWrap: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  messageActions: { flexDirection: 'row', gap: 4, marginTop: 4, marginLeft: 4 },
  actionBtn: { padding: 4 },

  sourcesWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 6, marginLeft: 4, gap: 6, maxWidth: '82%' },
  sourceChip: { backgroundColor: '#1A1A2A', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#2A2A3A', maxWidth: 180 },
  sourceChipText: { color: '#666', fontSize: 11 },
  bubble: { maxWidth: '82%', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 12, marginVertical: 2 },
  bubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  bubbleAI: { alignSelf: 'flex-start', backgroundColor: '#161625', borderBottomLeftRadius: 6 },
  bubbleText: { color: '#c8c8d8', fontSize: 15, lineHeight: 24, fontFamily: 'Inter, system-ui, -apple-system, sans-serif' },
  bubbleTextUser: { color: '#fff' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { color: '#333', fontSize: 16, textAlign: 'center', paddingHorizontal: 32, lineHeight: 26 },

  imagePreviewWrap: { marginHorizontal: 12, marginBottom: 8, position: 'relative', alignSelf: 'flex-start' },
  imagePreview: { width: 80, height: 80, borderRadius: 12 },
  imageRemove: { position: 'absolute', top: -6, right: -6, backgroundColor: '#EF4444', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  imageRemoveText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 8, paddingVertical: 10, gap: 6, borderTopWidth: 1, borderTopColor: '#1A1A2A', backgroundColor: '#0F0F1A' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { fontSize: 28, fontWeight: '300', lineHeight: 32 },
  input: { flex: 1, backgroundColor: '#161625', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: '#fff', fontSize: 15, maxHeight: 120, fontFamily: 'Inter, system-ui, -apple-system, sans-serif' },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
