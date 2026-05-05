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

  // New profile creation state
  const [isNew, setIsNew] = useState(false);
  const [step, setStep] = useState<'info' | 'set-pin' | 'confirm-pin'>('info');
  const [name, setName] = useState('');
  const [aiName, setAiName] = useState('');
  const [firstPin, setFirstPin] = useState('');

  useEffect(() => {
    loadProfile();
  }, [slot]);

  async function loadProfile() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('slot', slotNum)
      .maybeSingle();
    if (data) {
      setProfile(data);
      setIsNew(false);
    } else {
      setIsNew(true);
    }
    setLoading(false);
  }

  function handleDigit(digit: string) {
    if (digit === '⌫') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (digit === '') return;
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) {
      setTimeout(() => handlePinComplete(next), 150);
    }
  }

  async function handlePinComplete(entered: string) {
    if (isNew) {
      if (step === 'set-pin') {
        setFirstPin(entered);
        setPin('');
        setStep('confirm-pin');
      } else if (step === 'confirm-pin') {
        if (entered !== firstPin) {
          Alert.alert('PINs do not match', 'Try again.');
          setPin('');
          setStep('set-pin');
          setFirstPin('');
          return;
        }
        await createProfile(entered);
      }
    } else {
      if (entered === profile!.pin) {
        router.replace({ pathname: '/chat', params: { profileId: profile!.id } });
      } else {
        Alert.alert('Wrong PIN', 'Try again.');
        setPin('');
      }
    }
  }

  async function createProfile(pinValue: string) {
    const { data, error } = await supabase
      .from('profiles')
      .insert({ slot: slotNum, name: name.trim(), ai_name: aiName.trim(), pin: pinValue })
      .select()
      .single();
    if (error || !data) {
      Alert.alert('Error', 'Could not create profile. Try again.');
      setPin('');
      setStep('set-pin');
      return;
    }
    router.replace({ pathname: '/chat', params: { profileId: data.id } });
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={color} size="large" />
      </View>
    );
  }

  // New profile — collect name + AI name first
  if (isNew && step === 'info') {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={styles.center}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.heading}>New Profile</Text>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            style={[styles.input, { borderColor: color }]}
            placeholder="e.g. Srivani"
            placeholderTextColor="#444"
            value={name}
            onChangeText={setName}
            autoFocus
          />
          <Text style={styles.label}>Your AI's name</Text>
          <TextInput
            style={[styles.input, { borderColor: color }]}
            placeholder="e.g. Nova"
            placeholderTextColor="#444"
            value={aiName}
            onChangeText={setAiName}
          />
          <TouchableOpacity
            style={[styles.button, { backgroundColor: color, opacity: name && aiName ? 1 : 0.4 }]}
            disabled={!name || !aiName}
            onPress={() => setStep('set-pin')}
          >
            <Text style={styles.buttonText}>Set PIN →</Text>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // PIN entry / PIN set / PIN confirm
  const pinLabel = isNew
    ? step === 'set-pin'
      ? `Set a 4-digit PIN, ${name}`
      : 'Confirm your PIN'
    : `Welcome back, ${profile!.name}`;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <View style={styles.center}>
        <View style={[styles.avatar, { backgroundColor: color }]}>
          <Text style={styles.avatarText}>
            {isNew ? name[0]?.toUpperCase() : profile!.name[0].toUpperCase()}
          </Text>
        </View>
        <Text style={styles.heading}>{pinLabel}</Text>

        {/* PIN dots */}
        <View style={styles.dots}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[styles.dot, { backgroundColor: pin.length > i ? color : '#333' }]}
            />
          ))}
        </View>

        {/* Number pad */}
        <View style={styles.pad}>
          {DIGITS.map((d, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.key, d === '' && styles.keyHidden]}
              onPress={() => handleDigit(d)}
              disabled={d === ''}
            >
              <Text style={styles.keyText}>{d}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F0F1A' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  back: { position: 'absolute', top: 56, left: 24, zIndex: 10 },
  backText: { color: '#666', fontSize: 16 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  avatarText: { color: '#fff', fontSize: 30, fontWeight: '700' },
  heading: { color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: 32, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 16, marginBottom: 40 },
  dot: { width: 16, height: 16, borderRadius: 8 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 264, justifyContent: 'center' },
  key: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 4,
    borderRadius: 40,
    backgroundColor: '#1E1E2E',
  },
  keyHidden: { backgroundColor: 'transparent' },
  keyText: { color: '#fff', fontSize: 24, fontWeight: '500' },
  label: { color: '#888', fontSize: 13, alignSelf: 'flex-start', marginBottom: 6, marginTop: 16 },
  input: {
    width: '100%',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    backgroundColor: '#1E1E2E',
  },
  button: {
    marginTop: 32,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
