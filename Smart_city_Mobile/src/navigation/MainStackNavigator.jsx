import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import BottomTabNavigator from './BottomTabNavigator';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import PreRegisterVisitorScreen from '../screens/visitors/PreRegisterVisitorScreen';
import HelperRequestScreen from '../screens/helpers/HelperRequestScreen';
import HelperListScreen from '../screens/helpers/HelperListScreen';
import AdminNotificationScreen from '../screens/admin/AdminNotificationScreen';
import ReportIssueScreen from '../screens/reports/ReportIssueScreen';

const Stack = createNativeStackNavigator();

export default function MainStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={BottomTabNavigator} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} />
      <Stack.Screen name="PreRegister" component={PreRegisterVisitorScreen} />
      <Stack.Screen name="Helpers" component={HelperListScreen} />
      <Stack.Screen name="HelperRequest" component={HelperRequestScreen} />
      <Stack.Screen name="AdminNotifications" component={AdminNotificationScreen} />
      <Stack.Screen name="ReportIssue" component={ReportIssueScreen} />
    </Stack.Navigator>
  );
}
