import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { startSyncLoop, stopSyncLoop } from '@/lib/sync';

export default function ProtectedLayout() {
  const { session, loading } = useAuth();

  useEffect(() => {
    if (!session) return;
    startSyncLoop();
    return () => stopSyncLoop();
  }, [session]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="dashboard"
        options={{
          title: 'Project burn',
          headerBackTitle: 'Back'
        }}
      />
    </Stack>
  );
}
