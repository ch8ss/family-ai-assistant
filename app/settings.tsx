import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { Profile } from '../lib/types';

const SLOT_COLORS = ['#7C3AED', '#EC4899', '#06B6D4'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

interface VoiceOption {
  name: string;
  lang: string;
  localService: boolean;
}

export default function SettingsScreen() {
  const { profileId } = useLocalSearchParams<{ profileId: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [bio, setBio] = useState('');
  const [aiName, setAiName] = useState('');
  const [persistentMemory, setPersistentMemory] = useState(true);
  const [activeMode, setActiveMode] = useState<'academics' | 'business' | null>(null);

  // Voice
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voicePreference, setVoicePreference] = useState<string | null>(null);

  // PIN change state
  const [changingPin, setChangingPin] = useState(false);
  const [pinStep, setPinStep] = useState<'new' | 'confirm'>('new');
  const [pinInput, setPinInput] = useState('');
  const [firstPin, setFirstPin] = useState('');

  useEffect(() => {
    loadProfile();
  }, [profileId]);

  async function loadProfile() {
    const { data } = await supabase.from('profiles').select('*').eq('id', profileId).single();
    if (data) {
      setProfile(data);
      setBio(data.bio ?? '');
      setAiName(data.ai_name);
      setPersistentMemory(data.persistent_memory ?? true);
      setActiveMode(data.active_mode ?? null);
      setVoicePreference(data.voice_preference ?? null);
    }
    setLoading(false);
    loadVoices();
  }

  function loadVoices() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const populate = () => {
      const all = window.speechSynthesis.getVoices();
      const english = all.filter(v => v.lang.startsWith('en'));
      setVoices(english.map(v => ({ name: v.name, lang: v.lang, localService: v.localService })));
    };
    populate();
    window.speechSynthesis.onvoiceschanged = populate;
  }

  function previewVoice(voiceName: string) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const all = window.speechSynthesis.getVoices();
    const voice = all.find(v => v.name === voiceName);
    const utterance = new SpeechSynthesisUtterance(`Hey! I'm ${aiName || 'your AI'}. How can I help you today?`);
    utterance.rate = 1.05;
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }

  async function saveProfile() {
    if (!profile) return;
    setSaving(true);
    await supabase.from('profiles').update({
      bio: bio.trim() || null,
      ai_name: aiName.trim() || profile.ai_name,
      persistent_memory: persistentMemory,
      active_mode: activeMode,
      voice_preference: voicePreference,
    }).eq('id', profile.id);
    setSaving(false);
    Alert.alert('Saved', 'Your settings have been updated.');
  }

  function handlePinDigit(digit: string) {
    if (digit === '⌫') { setPinInput((p) => p.slice(0, -1)); return; }
    if (digit === '' || pinInput.length >= 4) return;
    const next = pinInput + digit;
    setPinInput(next);
    if (next.length === 4) setTimeout(() => handlePinComplete(next), 150);
  }

  async function handlePinComplete(entered: string) {
    if (pinStep === 'new') {
      setFirstPin(entered);
      setPinInput('');
      setPinStep('confirm');
    } else {
      if (entered !== firstPin) {
        Alert.alert("PINs don't match", 'Try again.');
        setPinInput('');
        setPinStep('new');
        setFirstPin('');
        return;
      }
      await supabase.from('profiles').update({ pin: entered }).eq('id', profile!.id);
      setChangingPin(false);
      setPinInput('');
      setPinStep('new');
      setFirstPin('');
      Alert.alert('Done', 'PIN updated successfully.');
    }
  }

  if (loading || !profile) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color="#7C3AED" /></View>;
  }

  const color = SLOT_COLORS[profile.slot - 1];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={20} color="#666" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Settings</Text>
          <TouchableOpacity onPress={saveProfile} style={styles.saveBtn} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color={color} /> : <Text style={[styles.saveBtnText, { color }]}>Save</Text>}
          </TouchableOpacity>
        </View>

        {/* Profile card */}
        <View style={styles.profileCard}>
          <View style={[styles.avatar, { backgroundColor: color + '22', borderColor: color }]}>
            <Text style={[styles.avatarText, { color }]}>{profile.name[0].toUpperCase()}</Text>
          </View>
          <Text style={styles.profileName}>{profile.name}</Text>
          <Text style={styles.profileSub}>slot {profile.slot}</Text>
        </View>

        {/* AI name */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>AI name</Text>
          <TextInput
            style={[styles.input, { borderColor: color }]}
            value={aiName}
            onChangeText={setAiName}
            placeholder="e.g. Nova"
            placeholderTextColor="#333"
          />
        </View>

        {/* Bio */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>About you</Text>
          <Text style={styles.sectionHint}>Tell your AI a bit about yourself — your life, routines, goals. The more it knows, the better it gets.</Text>
          <TextInput
            style={[styles.bioInput, { borderColor: color }]}
            value={bio}
            onChangeText={setBio}
            placeholder={`e.g. I'm ${profile.name}, I'm studying computer science, I work out 3x a week, I'm trying to eat healthier...`}
            placeholderTextColor="#333"
            multiline
            numberOfLines={5}
          />
        </View>

        {/* Memory */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Memory</Text>
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Persistent memory</Text>
              <Text style={styles.toggleHint}>When on, your AI remembers context from all your past conversations, not just the current one.</Text>
            </View>
            <Switch
              value={persistentMemory}
              onValueChange={setPersistentMemory}
              trackColor={{ false: '#1E1E2E', true: color + '88' }}
              thumbColor={persistentMemory ? color : '#444'}
            />
          </View>
        </View>

        {/* Modes */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Focus mode</Text>
          <Text style={styles.sectionHint}>Activate a mode for focused, specialised help. Turn off to go back to normal.</Text>
          {(['academics', 'business'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.modeRow, activeMode === m && { borderColor: color, backgroundColor: color + '10' }]}
              onPress={() => setActiveMode(activeMode === m ? null : m)}
            >
              <Ionicons
                name={m === 'academics' ? 'book-outline' : 'briefcase-outline'}
                size={18}
                color={activeMode === m ? color : '#555'}
              />
              <View style={styles.modeInfo}>
                <Text style={[styles.modeTitle, activeMode === m && { color }]}>
                  {m === 'academics' ? 'Academics & Math' : 'Business & Decisions'}
                </Text>
                <Text style={styles.modeHint}>
                  {m === 'academics'
                    ? 'Precise, step-by-step help with any subject or problem.'
                    : 'Sharp, strategic advice for business questions and decisions.'}
                </Text>
              </View>
              <View style={[styles.modeIndicator, activeMode === m && { backgroundColor: color }]} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Voice picker */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>AI voice</Text>
          <Text style={styles.sectionHint}>Choose how your AI sounds when reading aloud. Tap the play icon to preview.</Text>
          {voices.length === 0 && (
            <Text style={styles.noVoices}>No voices found. Try opening this on a browser.</Text>
          )}
          {voices.map((v) => (
            <TouchableOpacity
              key={v.name}
              style={[styles.voiceRow, voicePreference === v.name && { borderColor: color, backgroundColor: color + '10' }]}
              onPress={() => setVoicePreference(v.name)}
            >
              <View style={styles.voiceInfo}>
                <Text style={[styles.voiceName, voicePreference === v.name && { color }]} numberOfLines={1}>
                  {v.name}
                </Text>
                <Text style={styles.voiceLang}>{v.lang}{v.localService ? ' · device' : ' · online'}</Text>
              </View>
              <TouchableOpacity onPress={() => previewVoice(v.name)} style={styles.previewBtn}>
                <Ionicons name="play-circle-outline" size={22} color={voicePreference === v.name ? color : '#444'} />
              </TouchableOpacity>
              {voicePreference === v.name && (
                <Ionicons name="checkmark-circle" size={18} color={color} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Change PIN */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Security</Text>
          {!changingPin ? (
            <TouchableOpacity style={styles.pinBtn} onPress={() => setChangingPin(true)}>
              <Ionicons name="lock-closed-outline" size={16} color="#666" />
              <Text style={styles.pinBtnText}>Change PIN</Text>
              <Ionicons name="chevron-forward" size={16} color="#333" />
            </TouchableOpacity>
          ) : (
            <View style={styles.pinSection}>
              <Text style={styles.pinLabel}>
                {pinStep === 'new' ? 'Enter new PIN' : 'Confirm new PIN'}
              </Text>
              <View style={styles.dots}>
                {[0, 1, 2, 3].map((i) => (
                  <View key={i} style={[styles.dot, pinInput.length > i && { backgroundColor: color }]} />
                ))}
              </View>
              <View style={styles.pad}>
                {DIGITS.map((d, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.key, d === '' && styles.keyHidden]}
                    onPress={() => handlePinDigit(d)}
                    disabled={d === ''}
                  >
                    <Text style={styles.keyText}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity onPress={() => { setChangingPin(false); setPinInput(''); setPinStep('new'); setFirstPin(''); }}>
                <Text style={styles.cancelPin}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A14' },
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 40 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A2A',
  },
  backBtn: { padding: 4 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  saveBtn: { padding: 4 },
  saveBtnText: { fontSize: 15, fontWeight: '700' },

  profileCard: { alignItems: 'center', paddingVertical: 32 },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 28, fontWeight: '800' },
  profileName: { color: '#fff', fontSize: 20, fontWeight: '700' },
  profileSub: { color: '#333', fontSize: 13, marginTop: 4 },

  section: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#1A1A2A',
  },
  sectionLabel: { color: '#444', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 },
  sectionHint: { color: '#333', fontSize: 13, lineHeight: 19, marginBottom: 14 },

  input: { borderWidth: 1.5, borderRadius: 12, padding: 13, color: '#fff', fontSize: 15, backgroundColor: '#12121E' },
  bioInput: { borderWidth: 1.5, borderRadius: 12, padding: 13, color: '#fff', fontSize: 14, backgroundColor: '#12121E', minHeight: 110, textAlignVertical: 'top', lineHeight: 21 },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  toggleInfo: { flex: 1 },
  toggleTitle: { color: '#ccc', fontSize: 15, fontWeight: '600', marginBottom: 4 },
  toggleHint: { color: '#444', fontSize: 12, lineHeight: 18 },

  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E1E2E',
    backgroundColor: '#0D0D1A',
    marginBottom: 10,
  },
  modeInfo: { flex: 1 },
  modeTitle: { color: '#ccc', fontSize: 15, fontWeight: '600', marginBottom: 3 },
  modeHint: { color: '#444', fontSize: 12, lineHeight: 17 },
  modeIndicator: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1E1E2E' },

  noVoices: { color: '#333', fontSize: 13, fontStyle: 'italic' },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E1E2E',
    backgroundColor: '#0D0D1A',
    marginBottom: 8,
  },
  voiceInfo: { flex: 1 },
  voiceName: { color: '#bbb', fontSize: 14, fontWeight: '500' },
  voiceLang: { color: '#333', fontSize: 11, marginTop: 2 },
  previewBtn: { padding: 2 },
  pinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#12121E',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E1E2E',
  },
  pinBtnText: { flex: 1, color: '#ccc', fontSize: 15, fontWeight: '500' },

  pinSection: { alignItems: 'center', paddingTop: 8 },
  pinLabel: { color: '#ccc', fontSize: 16, fontWeight: '600', marginBottom: 24 },
  dots: { flexDirection: 'row', gap: 16, marginBottom: 32 },
  dot: { width: 13, height: 13, borderRadius: 7, backgroundColor: '#222' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 264, justifyContent: 'center', gap: 8, marginBottom: 20 },
  key: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center', borderRadius: 38, backgroundColor: '#12121E', borderWidth: 1, borderColor: '#1E1E2E' },
  keyHidden: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyText: { color: '#fff', fontSize: 24, fontWeight: '400' },
  cancelPin: { color: '#444', fontSize: 14, marginTop: 8 },
});
