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
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { sendMessage, getDailyTokensUsed } from '../lib/groq';
import { Message, Profile, Conversation } from '../lib/types';

const SLOT_COLORS = ['#7C3AED', '#EC4899', '#06B6D4'];
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
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    if (profileId) bootstrap();
  }, [profileId]);

  useEffect(() => {
    setSidebarOpen(isWide);
  }, [isWide]);

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
      const replyText = await sendMessage(profile, userText, messages);

      const { data: savedUser } = await supabase
        .from('messages')
        .insert({ profile_id: profile.id, conversation_id: activeConvId, role: 'user', content: userText })
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
                  <Text style={styles.emptyText}>
                    Hey {profile.name}! I'm {profile.ai_name}. What's on your mind?
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
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
              )}
            />

            {thinking && (
              <View style={styles.thinkingRow}>
                <ActivityIndicator color={color} size="small" />
                <Text style={styles.thinkingText}>{profile.ai_name} is thinking…</Text>
              </View>
            )}

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder={`Message ${profile.ai_name}…`}
                placeholderTextColor="#444"
                value={input}
                onChangeText={setInput}
                multiline
                onSubmitEditing={handleSend}
              />
              <TouchableOpacity
                style={[styles.sendBtn, { backgroundColor: input.trim() ? color : '#1E1E2E' }]}
                onPress={handleSend}
                disabled={!input.trim() || thinking}
              >
                <Text style={styles.sendText}>↑</Text>
              </TouchableOpacity>
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

  newChatBtn: {
    margin: 12,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  newChatText: { fontSize: 14, fontWeight: '600' },

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
  bubble: {
    maxWidth: '82%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginVertical: 3,
  },
  bubbleUser: { alignSelf: 'flex-end' },
  bubbleAI: { alignSelf: 'flex-start', backgroundColor: '#1E1E2E' },
  bubbleText: { color: '#ccc', fontSize: 15, lineHeight: 22 },
  bubbleTextUser: { color: '#fff' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { color: '#555', fontSize: 15, textAlign: 'center', paddingHorizontal: 32, lineHeight: 22 },

  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  thinkingText: { color: '#555', fontSize: 13 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    gap: 8,
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
