import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import Card from '../../components/Card';
import { useTheme } from '../../context/ThemeContext';
import {
  fetchHelpers,
  fetchMyHelperRequests,
} from '../../api/helpers';

function getExperienceText(value) {
  const years = Number(value || 0);
  if (!years) return 'New helper';
  if (years === 1) return '1 year experience';
  return `${years} years experience`;
}

export default function HelperListScreen({ navigation }) {
  const { theme } = useTheme();
  const [helpers, setHelpers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const activeRequestCount = requests.filter((item) => item.status !== 'Completed').length;

  const loadHelpers = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [helperData, requestData] = await Promise.all([
        fetchHelpers({ status: 'Active' }),
        fetchMyHelperRequests(),
      ]);
      setHelpers(helperData);
      setRequests(requestData);
    } catch (err) {
      if (err.sessionExpired) return;
      setError(err.message || 'Failed to load helpers');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHelpers();
    }, [loadHelpers]),
  );

  const renderHelper = ({ item }) => (
    <Card>
      <View style={styles.helperRow}>
        {item.photo ? (
          <Image source={{ uri: item.photo }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: theme.primary + '18' }]}>
            <Ionicons name="person-outline" size={24} color={theme.primary} />
          </View>
        )}
        <View style={styles.helperInfo}>
          <View style={styles.titleRow}>
            <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
              {item.fullname}
            </Text>
            <View style={[styles.statusBadge, { backgroundColor: theme.successBg }]}>
              <Text style={[styles.statusText, { color: theme.success }]}>
                {item.status || 'Active'}
              </Text>
            </View>
          </View>
          <Text style={[styles.meta, { color: theme.subtext }]}>
            {[item.gender, getExperienceText(item.experience)].filter(Boolean).join(' · ')}
          </Text>
          {item.phone ? (
            <View style={styles.phoneRow}>
              <Ionicons name="call-outline" size={13} color={theme.subtext} />
              <Text style={[styles.phone, { color: theme.subtext }]}>{item.phone}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <TouchableOpacity
        style={[styles.requestBtn, { backgroundColor: theme.primary }]}
        onPress={() => navigation.navigate('HelperRequest', { helper: item })}
        activeOpacity={0.85}>
        <Ionicons name="add-circle-outline" size={18} color={theme.primaryText} />
        <Text style={[styles.requestText, { color: theme.primaryText }]}>Request helper</Text>
      </TouchableOpacity>
    </Card>
  );

  return (
    <ScreenContainer
      navigation={navigation}
      topBarVariant="stack"
      title="Helpers"
      showBottomNav>
      <FlatList
        data={helpers}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadHelpers(true)}
            tintColor={theme.primary}
          />
        }
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <View>
                <Text style={[styles.heading, { color: theme.text }]}>Helpers</Text>
                <Text style={[styles.sub, { color: theme.subtext }]}>
                  {activeRequestCount
                    ? `${activeRequestCount} active requests`
                    : 'Available house helpers'}
                </Text>
              </View>
            </View>

            {error ? (
              <View style={[styles.errorBanner, { borderColor: theme.danger }]}>
                <Ionicons name="alert-circle-outline" size={18} color={theme.danger} />
                <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : (
            <View style={styles.centered}>
              <Ionicons name="people-outline" size={36} color={theme.inactive} />
              <Text style={[styles.emptyText, { color: theme.subtext }]}>No helpers available</Text>
            </View>
          )
        }
        renderItem={renderHelper}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  heading: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3, marginBottom: 4 },
  sub: { fontSize: 14 },
  helperRow: { flexDirection: 'row', marginBottom: 14 },
  avatar: { width: 58, height: 58, borderRadius: 14, marginRight: 12 },
  avatarFallback: {
    width: 58,
    height: 58,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  helperInfo: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  name: { flex: 1, fontSize: 16, fontWeight: '700' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 13, marginBottom: 6 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  phone: { fontSize: 13 },
  requestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 11,
  },
  requestText: { fontSize: 14, fontWeight: '700' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 13 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 15, textAlign: 'center' },
});
