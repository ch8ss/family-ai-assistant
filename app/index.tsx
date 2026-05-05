import React, { useCallback, useState } from 'react';
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

const SLOTS = [
  { color: '#7C3AED', glow: '#7C3AED22' },
  { color: '#EC4899', glow: '#EC489922' },
  { color: '#06B6D4', glow: '#06B6D422' },
];

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
      <View style={styles.inner}>
        <Text style={styles.wordmark}>family ai</Text>
        <Text style={styles.heading}>hey, who's this?</Text>
        <Text style={styles.sub}>pick your profile to start chatting</Text>

        <View style={styles.cards}>
          {profiles.map((profile, i) => {
            const slot = SLOTS[i];
            return (
              <TouchableOpacity
                key={i}
                style={[styles.card, { borderColor: slot.color, shadowColor: slot.color }]}
                onPress={() =>
                  router.push({ pathname: '/pin', params: { slot: String(i + 1) } })
                }
                activeOpacity={0.75}
              >
                <View style={[styles.cardAccent, { backgroundColor: slot.color }]} />
                <View style={[styles.avatar, { backgroundColor: slot.color + '22', borderColor: slot.color }]}>
                  <Text style={[styles.avatarText, { color: slot.color }]}>
                    {profile ? profile.name[0].toUpperCase() : '+'}
                  </Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>
                    {profile ? profile.name : 'Add profile'}
                  </Text>
                  {profile ? (
                    <Text style={[styles.cardAI, { color: slot.color }]}>
                      chatting with {profile.ai_name}
                    </Text>
                  ) : (
                    <Text style={styles.cardAIEmpty}>tap to set up</Text>
                  )}
                </View>
                <Text style={[styles.arrow, { color: slot.color }]}>›</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A14' },
  center: { alignItems: 'center', justifyContent: 'center' },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  wordmark: {
    color: '#333',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 24,
  },
  heading: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  sub: {
    color: '#444',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 48,
  },
  cards: { gap: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#12121E',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    paddingRight: 20,
  },
  cardAccent: { width: 4, alignSelf: 'stretch' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 16,
  },
  avatarText: { fontSize: 22, fontWeight: '800' },
  cardInfo: { flex: 1 },
  cardName: { color: '#fff', fontSize: 17, fontWeight: '700' },
  cardAI: { fontSize: 13, marginTop: 3, fontWeight: '500' },
  cardAIEmpty: { color: '#333', fontSize: 13, marginTop: 3 },
  arrow: { fontSize: 28, fontWeight: '300' },
});
