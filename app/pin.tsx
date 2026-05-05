import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { Profile } from '../lib/types';

const SLOT_COLORS = ['#7C3AED', '#EC4899', '#06B6D4'];
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export default function PinScreen() {
  const { slot } = useLocalSearchParams<{ slot: string }>();
  const slotNum = parseInt(slot ?? '1');
  const color = SLOT_COLORS[slotNum - 1];

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);

  const [isNew, setIsNew] = useState(false);
  const [step, setStep] = useState<'info' | 'set-pin' | 'confirm-pin'>('info');
  const [name, setName] = useState('');
  const [aiName, setAiName] = useState('');
  const [firstPin, setFirstPin] = useState('');

  useEffect(() => { loadProfile(); }, [slot]);

  async function loadProfile() {
    const { data } = await supabase
      .from('profiles').select('*').eq('slot', slotNum).maybeSingle();
    if (data) { setProfile(data); setIsNew(false); }
    else setIsNew(true);
    setLoading(false);
  }

  function handleDigit(digit: string) {
    if (digit === '⌫') { setPin((p) => p.slice(0, -1)); return; }
    if (digit === '' || pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) setTimeout(() => handlePinComplete(next), 150);
  }

  async function handlePinComplete(entered: string) {
    if (isNew) {
      if (step === 'set-pin') { setFirstPin(entered); setPin(''); setStep('confirm-pin'); }
      else if (step === 'confirm-pin') {
        if (entered !== firstPin) {
          setPin(''); setStep('set-pin'); setFirstPin('');
          Alert.alert("Oops!", "PINs didn't match. Try again.");
          return;
        }
        await createProfile(entered);
      }
    } else {
      if (entered === profile!.pin) {
        router.replace({ pathname: '/chat', params: { profileId: profile!.id } });
      } else {
        setPin('');
        Alert.alert("Nope!", "Wrong PIN, try again.");
      }
    }
  }

  async function createProfile(pinValue: string) {
    const { data, error } = await supabase
      .from('profiles')
      .insert({ slot: slotNum, name: name.trim(), ai_name: aiName.trim(), pin: pinValue })
      .select().single();
    if (error || !data) { Alert.alert('Error', 'Could not create profile.'); setPin(''); setStep('set-pin'); return; }
    router.replace({ pathname: '/chat', params: { profileId: data.id } });
  }

  if (loading) {
    return <View style={[styles.container, styles.center]}><ActivityIndicator color={color} size="large" /></View>;
  }

  if (isNew && step === 'info') {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Text style={styles.backText}>← back</Text>
          </TouchableOpacity>

          <View style={[styles.topBadge, { backgroundColor: color + '22', borderColor: color }]}>
            <Text style={[styles.topBadgeText, { color }]}>new profile</Text>
          </View>

          <Text style={styles.heading}>let's set you up</Text>
          <Text style={styles.sub}>what should we call you?</Text>

          <Text style={styles.label}>your name</Text>
          <TextInput
            style={[styles.input, { borderColor: color }]}
            placeholder="e.g. Srivani"
            placeholderTextColor="#333"
            value={name}
            onChangeText={setName}
            autoFocus
          />

          <Text style={styles.label}>your AI's name</Text>
          <TextInput
            style={[styles.input, { borderColor: color }]}
            placeholder="e.g. Nova, Luna, Sage..."
            placeholderTextColor="#333"
            value={aiName}
            onChangeText={setAiName}
          />

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: color, opacity: name && aiName ? 1 : 0.35 }]}
            disabled={!name || !aiName}
            onPress={() => setStep('set-pin')}
          >
            <Text style={styles.btnText}>set my PIN →</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const pinLabel = isNew
    ? step === 'set-pin' ? `choose a PIN, ${name}` : 'confirm your PIN'
    : `welcome back, ${profile!.name}`;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← back</Text>
      </TouchableOpacity>

      <View style={styles.center}>
        <View style={[styles.avatar, { backgroundColor: color + '22', borderColor: color }]}>
          <Text style={[styles.avatarText, { color }]}>
            {isNew ? (name[0]?.toUpperCase() ?? '?') : profile!.name[0].toUpperCase()}
          </Text>
        </View>

        <Text style={styles.heading}>{pinLabel}</Text>

        <View style={styles.dots}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.dot,
                pin.length > i ? { backgroundColor: color, transform: [{ scale: 1.15 }] } : { backgroundColor: '#222' },
              ]}
            />
          ))}
        </View>

        <View style={styles.pad}>
          {DIGITS.map((d, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.key, d === '' && styles.keyHidden, d === '⌫' && styles.keyDel]}
              onPress={() => handleDigit(d)}
              disabled={d === ''}
              activeOpacity={0.6}
            >
              <Text style={[styles.keyText, d === '⌫' && { color: '#666', fontSize: 20 }]}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A14' },
  kav: { flex: 1, paddingHorizontal: 32, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  back: { position: 'absolute', top: 56, left: 24, zIndex: 10 },
  backText: { color: '#444', fontSize: 15 },
  topBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 16,
  },
  topBadgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  heading: { color: '#fff', fontSize: 26, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  sub: { color: '#444', fontSize: 14, marginBottom: 32, textAlign: 'center' },
  label: { color: '#555', fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', alignSelf: 'flex-start', marginBottom: 8, marginTop: 20 },
  input: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    backgroundColor: '#12121E',
  },
  btn: { marginTop: 36, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  avatarText: { fontSize: 32, fontWeight: '800' },
  dots: { flexDirection: 'row', gap: 18, marginBottom: 44, marginTop: 8 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 272, justifyContent: 'center', gap: 8 },
  key: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 40,
    backgroundColor: '#12121E',
    borderWidth: 1,
    borderColor: '#1E1E2E',
  },
  keyHidden: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyDel: { backgroundColor: '#0A0A14' },
  keyText: { color: '#fff', fontSize: 26, fontWeight: '400' },
});
