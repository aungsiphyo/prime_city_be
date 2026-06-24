import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  View,
  Text,
  FlatList,
  ImageBackground,
  Linking,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import ScreenContainer from '../../components/ScreenContainer';
import Card from '../../components/Card';
// local chat components removed: using global FloatingChat instead
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { fetchAnnouncements } from '../../api/announcements';
import { fetchAdvertisements } from '../../api/advertisements';

const QUICK_ACTIONS = [
  { id: 'bills', label: 'Bills', icon: 'receipt-outline', screen: 'Bills' },
  { id: 'helpers', label: 'Helpers', icon: 'people-outline', screen: 'Helpers' },
  {
    id: 'visitor',
    label: 'Visitor',
    icon: 'person-add-outline',
    screen: 'PreRegister',
  },
  {
    id: 'alerts',
    label: 'Alerts',
    icon: 'notifications-outline',
    screen: 'Notifications',
  },
  {
    id: 'news',
    label: 'News',
    icon: 'megaphone-outline',
    screen: 'Announcements',
  },
];

const TYPE_COLORS = {
  Maintenance: 'warning',
  Event: 'primary',
};

const AD_WINDOW_SIZE = 7;

function getAdvertisementWindow(items, startIndex) {
  if (items.length <= AD_WINDOW_SIZE) return items;

  return Array.from(
    { length: AD_WINDOW_SIZE },
    (_, index) => items[(startIndex + index) % items.length],
  );
}

function AdvertisementCarousel({ advertisements, loading }) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const listRef = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = useState(0);
  const [windowStart, setWindowStart] = useState(0);
  const [failedImages, setFailedImages] = useState({});
  const cardWidth = Math.max(280, width - 32);
  const snapWidth = cardWidth + 12;
  const visibleAdvertisements = useMemo(
    () => getAdvertisementWindow(advertisements, windowStart),
    [advertisements, windowStart],
  );

  useEffect(() => {
    setWindowStart(0);
    setFailedImages({});
  }, [advertisements]);

  useEffect(() => {
    setActiveIndex(0);
    scrollX.setValue(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [advertisements, scrollX, snapWidth, windowStart]);

  useEffect(() => {
    if (visibleAdvertisements.length < 2) return undefined;

    const timer = setInterval(() => {
      setActiveIndex((currentIndex) => {
        const nextIndex = currentIndex + 1;

        if (nextIndex < visibleAdvertisements.length) {
          listRef.current?.scrollToOffset({
            offset: nextIndex * snapWidth,
            animated: true,
          });
          return nextIndex;
        }

        if (advertisements.length > AD_WINDOW_SIZE) {
          setWindowStart((currentStart) =>
            (currentStart + AD_WINDOW_SIZE) % advertisements.length,
          );
        } else {
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        }

        return 0;
      });
    }, 4500);

    return () => clearInterval(timer);
  }, [advertisements.length, snapWidth, visibleAdvertisements.length]);

  const onMomentumEnd = (event) => {
    const offset = event.nativeEvent.contentOffset.x;
    const nextIndex = Math.round(offset / snapWidth);
    setActiveIndex(Math.max(0, Math.min(nextIndex, visibleAdvertisements.length - 1)));
  };

  if (loading) {
    return (
      <View style={styles.adsSection}>
        <View style={[styles.adSkeleton, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <ActivityIndicator color={theme.primary} />
        </View>
      </View>
    );
  }

  if (!advertisements.length) return null;

  return (
    <View style={styles.adsSection}>
      <View style={styles.adsHeader}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Advertisements</Text>
        <Text style={[styles.adsCount, { color: theme.subtext }]}>
          {activeIndex + 1}/{visibleAdvertisements.length}
          {advertisements.length > AD_WINDOW_SIZE ? ` · ${advertisements.length} total` : ''}
        </Text>
      </View>
      <Animated.FlatList
        ref={listRef}
        data={visibleAdvertisements}
        extraData={windowStart}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={snapWidth}
        decelerationRate="fast"
        onMomentumScrollEnd={onMomentumEnd}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
        renderItem={({ item, index }) => {
          const showImage = item.imageUrl && !failedImages[item.id];
          const inputRange = [
            (index - 1) * snapWidth,
            index * snapWidth,
            (index + 1) * snapWidth,
          ];
          const scale = scrollX.interpolate({
            inputRange,
            outputRange: [0.94, 1, 0.94],
            extrapolate: 'clamp',
          });
          const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0.72, 1, 0.72],
            extrapolate: 'clamp',
          });

          const card = (
            <Animated.View
              style={[
                styles.adCard,
                {
                  width: cardWidth,
                  opacity,
                  transform: [{ scale }],
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                },
              ]}>
              {showImage ? (
                <ImageBackground
                  source={{ uri: item.imageUrl }}
                  style={styles.adImage}
                  resizeMode="cover"
                  onError={() =>
                    setFailedImages((current) => ({ ...current, [item.id]: true }))
                  }
                  imageStyle={styles.adImageStyle}>
                  <View style={styles.adImageOverlay}>
                    <View style={styles.adContent}>
                      <Text style={styles.adCompany} numberOfLines={1}>
                        {item.companyName || 'Sponsored'}
                      </Text>
                      <Text style={styles.adTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={styles.adText} numberOfLines={2}>
                        {item.content}
                      </Text>
                    </View>
                  </View>
                </ImageBackground>
              ) : (
                <View style={styles.adFallback}>
                  <View style={[styles.adFallbackIcon, { backgroundColor: theme.primary + '18' }]}>
                    <Ionicons name="image-outline" size={26} color={theme.primary} />
                  </View>
                  <View style={styles.adFallbackCopy}>
                    <Text style={[styles.adFallbackCompany, { color: theme.subtext }]} numberOfLines={1}>
                      {item.companyName || 'Sponsored'}
                    </Text>
                    <Text style={[styles.adFallbackTitle, { color: theme.text }]} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={[styles.adFallbackText, { color: theme.subtext }]} numberOfLines={2}>
                      {item.content}
                    </Text>
                  </View>
                </View>
              )}
            </Animated.View>
          );

          return (
            <TouchableOpacity
              activeOpacity={item.linkUrl ? 0.9 : 1}
              disabled={!item.linkUrl}
              onPress={() => Linking.openURL(item.linkUrl).catch(() => null)}
              style={styles.adTouchable}>
              {card}
            </TouchableOpacity>
          );
        }}
      />
      <View style={styles.adDots}>
        {visibleAdvertisements.map((item, index) => (
          <View
            key={item.id}
            style={[
              styles.adDot,
              activeIndex === index ? styles.adDotActive : styles.adDotInactive,
              {
                backgroundColor: activeIndex === index ? theme.primary : theme.border,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  // chat is managed globally by ChatProvider / FloatingChat
  const [announcements, setAnnouncements] = useState([]);
  const [advertisements, setAdvertisements] = useState([]);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(true);
  const [loadingAdvertisements, setLoadingAdvertisements] = useState(true);
  const quickActions =
    user?.role === 'Admin'
      ? [
          {
            id: 'admin-notifications',
            label: 'Send Noti',
            icon: 'send-outline',
            screen: 'AdminNotifications',
          },
          ...QUICK_ACTIONS,
        ]
      : QUICK_ACTIONS;

  const navigateTo = screen => navigation.navigate(screen);

  const loadAnnouncements = useCallback(async () => {
    setLoadingAnnouncements(true);
    try {
      const data = await fetchAnnouncements({ limit: 5 });
      setAnnouncements(
        data.map((item) => ({
          id: item._id,
          title: item.title,
          message: item.message,
          type: item.type || 'General',
        })),
      );
    } catch (err) {
      if (!err.sessionExpired) setAnnouncements([]);
    } finally {
      setLoadingAnnouncements(false);
    }
  }, []);

  const loadAdvertisements = useCallback(async () => {
    setLoadingAdvertisements(true);
    try {
      const data = await fetchAdvertisements({ status: 'all' });
      setAdvertisements(data);
    } catch (err) {
      setAdvertisements([]);
    } finally {
      setLoadingAdvertisements(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAnnouncements();
      loadAdvertisements();
    }, [loadAdvertisements, loadAnnouncements]),
  );

  return (
    <ScreenContainer navigation={navigation}>
      <FlatList
        data={announcements}
        keyExtractor={i => i.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <View style={styles.hero}>
              <Text style={[styles.greeting, { color: theme.subtext }]}>
                Good morning
              </Text>
              <Text style={[styles.heading, { color: theme.text }]}>
                Welcome, Resident
              </Text>
              <Text style={[styles.sub, { color: theme.subtext }]}>
                Unit A-101 · Smart Residential
              </Text>
            </View>

            <AdvertisementCarousel
              advertisements={advertisements}
              loading={loadingAdvertisements}
            />

            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Quick actions
            </Text>
            <View style={styles.actionsRow}>
              {quickActions.map(action => (
                <TouchableOpacity
                  key={action.id}
                  style={[
                    styles.actionBtn,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                  onPress={() => navigateTo(action.screen)}
                >
                  <View
                    style={[
                      styles.actionIcon,
                      { backgroundColor: theme.primary + '22' },
                    ]}
                  >
                    <Ionicons
                      name={action.icon}
                      size={22}
                      color={theme.primary}
                    />
                  </View>
                  <Text style={[styles.actionLabel, { color: theme.text }]}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Card style={styles.reportCard}>
              <View style={styles.reportRow}>
                <View style={[styles.reportIcon, { backgroundColor: theme.warningBg }]}>
                  <Ionicons name="document-text-outline" size={22} color={theme.warning} />
                </View>
                <View style={styles.reportCopy}>
                  <Text style={[styles.reportTitle, { color: theme.text }]}>Submit a report</Text>
                  <Text style={[styles.reportSub, { color: theme.subtext }]}>
                    Maintenance, security, or community issues
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.reportBtn, { backgroundColor: theme.primary }]}
                onPress={() => navigateTo('ReportIssue')}
                activeOpacity={0.85}>
                <Ionicons name="send-outline" size={17} color={theme.primaryText} />
                <Text style={[styles.reportBtnText, { color: theme.primaryText }]}>Report now</Text>
              </TouchableOpacity>
            </Card>

            <Text style={[styles.sectionTitle, { color: theme.text }]}>
              Latest announcements
            </Text>
          </>
        }
        ListEmptyComponent={
          loadingAnnouncements ? (
            <View style={styles.emptyAnnouncements}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : (
            <Card>
              <View style={styles.emptyRow}>
                <Ionicons name="megaphone-outline" size={20} color={theme.inactive} />
                <Text style={[styles.emptyText, { color: theme.subtext }]}>
                  No announcements yet
                </Text>
              </View>
            </Card>
          )
        }
        renderItem={({ item }) => {
          const accent = TYPE_COLORS[item.type] || 'primary';
          const accentColor = theme[accent];
          const accentBg = theme[`${accent}Bg`] || theme.card;
          return (
            <Card>
              <View style={styles.cardHeader}>
                <View style={[styles.typeBadge, { backgroundColor: accentBg }]}>
                  <Ionicons
                    name={
                      item.type === 'Event'
                        ? 'calendar-outline'
                        : 'construct-outline'
                    }
                    size={14}
                    color={accentColor}
                  />
                  <Text style={[styles.typeText, { color: accentColor }]}>
                    {item.type}
                  </Text>
                </View>
              </View>
              <Text style={[styles.cardTitle, { color: theme.text }]}>
                {item.title}
              </Text>
              <Text style={[styles.cardText, { color: theme.subtext }]}>
                {item.message}
              </Text>
            </Card>
          );
        }}
      />

    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32 },
  hero: { marginBottom: 24 },
  greeting: { fontSize: 14, fontWeight: '500', marginBottom: 4 },
  heading: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  sub: { fontSize: 14 },
  adsSection: {
    marginBottom: 28,
  },
  adsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adsCount: { fontSize: 12, fontWeight: '700', marginBottom: 12 },
  adTouchable: { marginRight: 12 },
  adCard: {
    height: 178,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  adImage: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  adImageStyle: {
    borderRadius: 14,
  },
  adImageOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  adContent: {
    padding: 14,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  adCompany: {
    color: '#E0F7FA',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  adTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  adText: {
    color: '#E2E8F0',
    fontSize: 13,
    lineHeight: 18,
  },
  adFallback: {
    flex: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  adFallbackIcon: {
    width: 54,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  adFallbackCopy: { flex: 1 },
  adFallbackCompany: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  adFallbackTitle: { fontSize: 18, fontWeight: '800', marginBottom: 5 },
  adFallbackText: { fontSize: 13, lineHeight: 18 },
  adSkeleton: {
    height: 178,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  adDot: {
    height: 7,
    borderRadius: 4,
  },
  adDotActive: { width: 18 },
  adDotInactive: { width: 7 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 12 },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 28,
  },
  actionBtn: {
    width: '47%',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionLabel: { fontSize: 13, fontWeight: '600' },
  reportCard: { marginBottom: 28 },
  reportRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  reportIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  reportCopy: { flex: 1 },
  reportTitle: { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  reportSub: { fontSize: 13, lineHeight: 18 },
  reportBtn: {
    minHeight: 42,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  reportBtnText: { fontSize: 14, fontWeight: '700' },
  aiCard: { marginBottom: 28 },
  aiRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  aiIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  aiCopy: { flex: 1 },
  aiTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  aiSub: { fontSize: 13, lineHeight: 18 },
  aiCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  aiCtaText: { fontSize: 14, fontWeight: '600' },
  cardHeader: { marginBottom: 8 },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  typeText: { fontSize: 12, fontWeight: '600' },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardText: { fontSize: 14, lineHeight: 20 },
  emptyAnnouncements: { paddingVertical: 20 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 14 },
});
