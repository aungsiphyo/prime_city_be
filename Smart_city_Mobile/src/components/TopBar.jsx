import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';

export default function TopBar({ navigation, variant = 'main', title }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const isStack = variant === 'stack';

  return (
    <View
      style={[
        styles.wrapper,
        {
          paddingTop: insets.top,
          backgroundColor: theme.surface,
          borderBottomColor: theme.border,
        },
      ]}>
      <View style={styles.row}>
        {isStack ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation?.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={24} color={theme.icon} />
          </TouchableOpacity>
        ) : (
          <View style={styles.brand}>
            <View style={[styles.logoIcon, { backgroundColor: theme.primary }]}>
              <Ionicons name="business" size={16} color={theme.primaryText} />
            </View>
            <Text style={[styles.logo, { color: theme.text }]}>SmartRes</Text>
          </View>
        )}

        {isStack && (
          <Text style={[styles.stackTitle, { color: theme.text }]} numberOfLines={1}>
            {title}
          </Text>
        )}

        <View style={styles.actions}>
          {!isStack && (
            <>
              <TouchableOpacity
                style={[styles.iconBtn, { backgroundColor: theme.card }]}
                onPress={() => navigation?.navigate('Notifications')}>
                <Ionicons name="notifications-outline" size={20} color={theme.icon} />
                <View style={[styles.badge, { backgroundColor: theme.danger }]} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.iconBtn, { backgroundColor: theme.card }]}
                onPress={() => navigation?.navigate('PreRegister')}>
                <Ionicons name="person-add-outline" size={20} color={theme.icon} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderBottomWidth: 1,
  },
  row: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  brand: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    fontWeight: '700',
    fontSize: 18,
    letterSpacing: -0.3,
  },
  backBtn: {
    marginRight: 4,
  },
  stackTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    marginLeft: 4,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 'auto',
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
