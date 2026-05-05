import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0F0F1A' } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="pin" />
      <Stack.Screen name="chat" />
    </Stack>
  );
}
