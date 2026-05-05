import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { Profile } from '../lib/types';

const SLOT_COLORS = ['#7C3AED', '#EC4899', '#06B6D4'];

export default function ProfilePicker() {
  const [profiles, setProfiles] = useState<(Profile | null)[]>([null, null, null]);
  const [loading, setLoading] = useState(true);

  async function loadProfiles() {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('slot');
    const slots: (Profile | null)[] = [null, null, null];
    if (data) data.forEach((p) => { slots[p.slot - 1] = p; });
    setProfiles(slots);
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { loadProfiles(); }, []));

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color="#7C3AED" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Who's chatting?</Text>
      <View style={styles.grid}>
        {profiles.map((profile, i) => (
          <TouchableOpacity
            key={i}
            style={styles.card}
            onPress={() =>
              router.push({ pathname: '/pin', params: { slot: String(i + 1) } })
            }
          >
            <View style={[styles.avatar, { backgroundColor: SLOT_COLORS[i] }]}>
              <Text style={styles.avatarText}>
                {profile ? profile.name[0].toUpperCase() : '+'}
              </Text>
            </View>
            <Text style={styles.name}>{profile ? profile.name : 'Add Profile'}</Text>
            {profile && (
              <Text style={styles.aiName}>with {profile.ai_name}</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A' },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 64,
    marginBottom: 56,
    letterSpacing: 0.5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 32,
    paddingHorizontal: 24,
  },
  card: { alignItems: 'center', width: 110 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: { color: '#fff', fontSize: 34, fontWeight: '700' },
  name: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  aiName: { color: '#666', fontSize: 12, marginTop: 4, textAlign: 'center' },
});
