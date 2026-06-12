import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Ionicons from 'react-native-vector-icons/Ionicons';
import HomeScreen from '../screens/home/HomeScreen';
import BillsScreen from '../screens/bills/BillsScreen';
import AnnouncementsScreen from '../screens/announcements/AnnouncementsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import SosScreen from '../screens/sos/SosScreen';
import { useTheme } from '../context/ThemeContext';

const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Home: { active: 'home', inactive: 'home-outline' },
  Bills: { active: 'receipt', inactive: 'receipt-outline' },
  Announcements: { active: 'megaphone', inactive: 'megaphone-outline' },
  Profile: { active: 'person', inactive: 'person-outline' },
};

function SosTabButton({ onPress, accessibilityState }) {
  const focused = accessibilityState?.selected;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={styles.sosWrapper}>
      <View style={[styles.sosFab, focused && styles.sosFabFocused]}>
        <Ionicons name="alert" size={28} color="#FFFFFF" />
      </View>
    </TouchableOpacity>
  );
}

export default function BottomTabNavigator() {
  const { theme } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.tabBar,
          borderTopColor: theme.tabBarBorder,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 68,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 8,
          elevation: 0,
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.inactive,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
        },
        tabBarIcon: ({ color, focused }) => {
          if (route.name === 'SOS') return null;
          const icons = TAB_ICONS[route.name];
          const name = focused ? icons.active : icons.inactive;
          return <Ionicons name={name} size={22} color={color} />;
        },
      })}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Bills" component={BillsScreen} />
      <Tab.Screen
        name="SOS"
        component={SosScreen}
        options={{
          tabBarLabel: () => null,
          tabBarButton: (props) => <SosTabButton {...props} />,
        }}
      />
      <Tab.Screen name="Announcements" component={AnnouncementsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  sosWrapper: {
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
