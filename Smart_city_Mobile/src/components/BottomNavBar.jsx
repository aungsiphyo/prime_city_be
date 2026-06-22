import React, { useMemo } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';

const TABS = [
  { name: 'Home', label: 'Home', active: 'home', inactive: 'home-outline' },
  { name: 'Bills', label: 'Bills', active: 'receipt', inactive: 'receipt-outline' },
  { name: 'SOS', label: '', active: 'alert', inactive: 'alert' },
  {
    name: 'Announcements',
    label: 'News',
    active: 'megaphone',
    inactive: 'megaphone-outline',
  },
  { name: 'Profile', label: 'Profile', active: 'person', inactive: 'person-outline' },
];

export default function BottomNavBar({ navigation, activeRoute }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const wrapperStyle = useMemo(
    () => ({
      paddingBottom: Platform.OS === 'ios' ? Math.max(insets.bottom, 18) : 10,
      backgroundColor: theme.tabBar,
      borderTopColor: theme.tabBarBorder,
    }),
    [insets.bottom, theme.tabBar, theme.tabBarBorder],
  );

  const goToTab = (name) => {
    navigation?.navigate('Tabs', { screen: name });
  };

  return (
    <View style={[styles.wrapper, wrapperStyle]}>
      {TABS.map((tab) => {
        const focused = activeRoute === tab.name;

        if (tab.name === 'SOS') {
          return (
            <TouchableOpacity
              key={tab.name}
              style={styles.sosSlot}
              onPress={() => goToTab(tab.name)}
              activeOpacity={0.85}>
              <View style={[styles.sosFab, focused && styles.sosFabFocused]}>
                <Ionicons name="alert" size={28} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
          );
        }

        return (
          <TouchableOpacity
            key={tab.name}
            style={styles.tab}
            onPress={() => goToTab(tab.name)}
            activeOpacity={0.75}>
            <Ionicons
              name={focused ? tab.active : tab.inactive}
              size={22}
              color={focused ? theme.primary : theme.inactive}
            />
            <Text
              style={[
                styles.label,
                { color: focused ? theme.primary : theme.inactive },
              ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    minHeight: Platform.OS === 'ios' ? 88 : 68,
    paddingTop: 8,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  sosSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    top: -18,
  },
  sosFab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  sosFabFocused: {
    transform: [{ scale: 1.05 }],
  },
});
