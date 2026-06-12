import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import BottomTabNavigator from './BottomTabNavigator';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import PreRegisterVisitorScreen from '../screens/visitors/PreRegisterVisitorScreen';

const Stack = createNativeStackNavigator();

export default function MainStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={BottomTabNavigator} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="PreRegister" component={PreRegisterVisitorScreen} />
    </Stack.Navigator>
  );
}
