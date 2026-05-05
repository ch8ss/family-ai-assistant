import React, { useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { Profile } from '../lib/types';

const SLOTS = [
  { color: '#8B5CF6', glow: 'rgba(139,92,246,0.35)' },
  { color: '#EC4899', glow: 'rgba(236,72,153,0.35)' },
  { color: '#06B6D4', glow: 'rgba(6,182,212,0.35)' },
];

function ProfileCard({
  profile,
  slot,
  index,
  onPress,
}: {
  profile: Profile | null;
  slot: { color: string; glow: string };
  index: number;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  function pressIn() {
    Animated.parallel([
      Animated.spring(scale, { toValue: 0.93, useNativeDriver: true, speed: 30, bounciness: 0 }),
      Animated.timing(opacity, { toValue: 0.85, duration: 80, useNativeDriver: true }),
    ]).start();
  }

  function pressOut() {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 6 }),
      Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  }

  const isEmpty = !profile;

  return (
    <TouchableOpacity
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      activeOpacity={1}
      style={styles.cardWrapper}
    >
      <Animated.View style={[styles.cardInner, { transform: [{ scale }], opacity }]}>
        {/* Avatar */}
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: isEmpty ? '#1a1a2e' : slot.color,
              borderColor: isEmpty ? '#2a2a3e' : slot.color,
              shadowColor: slot.glow,
            },
          ]}
        >
          {isEmpty ? (
            <Text style={styles.plusIcon}>+</Text>
          ) : (
            <Text style={styles.avatarLetter}>
              {profile.name[0].toUpperCase()}
            </Text>
          )}
        </View>

        {/* Name */}
        <Text style={[styles.name, isEmpty && styles.nameEmpty]}>
          {isEmpty ? 'Add profile' : profile.name}
        </Text>

        {/* AI name */}
        {profile && (
          <Text style={[styles.aiName, { color: slot.color }]}>
            {profile.ai_name}
          </Text>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function ProfilePicker() {
  const [profiles, setProfiles] = useState<(Profile | null)[]>([null, null, null]);
  const [loading, setLoading] = useState(true);
  const { width } = useWindowDimensions();

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
        <ActivityIndicator color="#8B5CF6" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.wordmark}>family ai</Text>
        <Text style={styles.heading}>hey, who's this?</Text>

        <View style={[styles.grid, width < 500 && styles.gridNarrow]}>
          {profiles.map((profile, i) => (
            <ProfileCard
              key={i}
              profile={profile}
              slot={SLOTS[i]}
              index={i}
              onPress={() =>
                router.push({ pathname: '/pin', params: { slot: String(i + 1) } })
              }
            />
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A14' },
  center: { alignItems: 'center', justifyContent: 'center' },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  wordmark: {
    color: '#2a2a3a',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    letterSpacing: 5,
    textTransform: 'uppercase',
    marginBottom: 28,
  },
  heading: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '800',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    letterSpacing: -0.5,
    marginBottom: 56,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 32,
  },
  gridNarrow: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 24,
  },
  cardWrapper: {
    alignItems: 'center',
  },
  cardInner: {
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 130,
    height: 130,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  avatarLetter: {
    fontSize: 52,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
  },
  plusIcon: {
    fontSize: 44,
    fontWeight: '300',
    color: '#3a3a5a',
  },
  name: {
    color: '#ccc',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    letterSpacing: 0.2,
  },
  nameEmpty: {
    color: '#3a3a5a',
  },
  aiName: {
    fontSize: 13,
    fontWeight: '500',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    marginTop: -6,
    opacity: 0.85,
  },
});
