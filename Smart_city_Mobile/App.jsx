import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import ThemeProvider, { useTheme } from './src/context/ThemeContext';
import AuthProvider, { useAuth } from './src/context/AuthContext';
import { ChatProvider } from './src/context/ChatContext';
import FloatingChat from './src/components/FloatingChat';
import {
  cleanupPushNotifications,
  registerForPushNotifications,
  setupForegroundNotificationHandler,
} from './src/services/pushNotifications';

function AppContent() {
  const { theme } = useTheme();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    registerForPushNotifications();
    setupForegroundNotificationHandler();
    return cleanupPushNotifications;
  }, [isAuthenticated]);

  return (
    <>
      <StatusBar
        barStyle={theme.statusBar}
        backgroundColor={theme.background}
      />
      <AppNavigator />
      {isAuthenticated && <FloatingChat />}
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <ChatProvider>
              <AppContent />
            </ChatProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
