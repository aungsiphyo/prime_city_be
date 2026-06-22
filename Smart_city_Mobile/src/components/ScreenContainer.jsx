import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import TopBar from './TopBar';
import BottomNavBar from './BottomNavBar';

export default function ScreenContainer({
  navigation,
  children,
  showTopBar = true,
  topBarVariant = 'main',
  title,
  showBottomNav = false,
  activeRoute,
}) {
  const { theme } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {showTopBar && (
        <TopBar navigation={navigation} variant={topBarVariant} title={title} />
      )}
      <View style={styles.content}>{children}</View>
      {showBottomNav && (
        <BottomNavBar navigation={navigation} activeRoute={activeRoute} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
