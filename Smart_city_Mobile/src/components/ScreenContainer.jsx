import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import TopBar from './TopBar';

export default function ScreenContainer({ navigation, children, showTopBar = true }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {showTopBar && <TopBar navigation={navigation} />}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
});
