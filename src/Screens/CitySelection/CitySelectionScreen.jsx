import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowRight,
  Check,
  MapPin,
  RotateCcw,
  Search,
  ShieldAlert,
  WifiOff,
} from 'lucide-react-native';
import GradientButton from '../../components/GradientButton';
import ConfirmDialog from '../../components/ConfirmDialog';
import Loader from '../../components/Loader';
import { useToast } from '../../context/ToastContext';
import * as action from '../../Action/CitySelection/CitySelection_Action';
import { colors, radius, shadow, spacing } from '../../theme/theme';

/**
 * City selection — mirrors the old app's CitySelectionActivity: asks for the
 * mandatory runtime permissions, downloads CityDetails.json and stores the
 * picked city (which carries its own Firebase credentials).
 */
const CitySelectionScreen = ({ navigation }) => {
  const { showToast } = useToast();
  const [cities, setCities] = useState([]);
  const [allCities, setAllCities] = useState([]); // incl. hidden — for the DevTest shortcut
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [permDialog, setPermDialog] = useState(false);
  const [connecting, setConnecting] = useState(null); // city name while connecting

  const filtered = useMemo(() => action.filterCities(cities, query), [cities, query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { cities: list, all, fromCache, selectedKey } = await action.loadCities();
      setCities(list);
      setAllCities(all);
      setSelected(selectedKey);
      if (fromCache) showToast('Showing saved city list (offline)', 'info');
    } catch (e) {
      setError(e?.message || 'Could not load cities');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const checkPermissions = useCallback(async () => {
    const ok = await action.requestAppPermissions();
    if (!ok) setPermDialog(true);
  }, []);

  useEffect(() => {
    load();
    checkPermissions();
  }, [load, checkPermissions]);

  const handleContinue = async () => {
    const city = cities.find((c) => c.key === selected);
    if (!city) return;

    setConnecting(city.cityName);
    try {
      // Binds to this city's own Firebase project and verifies it responds
      await action.selectCity(city);
      // navigate (not replace) so Login's back returns here, like the old app
      navigation.navigate('Login');
    } catch (e) {
      showToast(e?.message || 'Could not connect to this city', 'error');
    } finally {
      setConnecting(null);
    }
  };

  /** Hidden shortcut: tap the logo to connect straight to DevTest. */
  const handleDevShortcut = async () => {
    setConnecting('DevTest');
    try {
      await action.connectToDevCity(allCities);
      showToast('Connected to DevTest', 'info');
      navigation.navigate('Login');
    } catch (e) {
      showToast(e?.message || 'Could not connect to DevTest', 'error');
    } finally {
      setConnecting(null);
    }
  };

  if (loading) return <Loader message="Loading cities…" />;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <View style={styles.orbTop} />

      {/* Brand — tapping the logo is the hidden DevTest shortcut */}
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.logoCircle, pressed && styles.logoPressed]}
          onPress={handleDevShortcut}
          disabled={!!connecting}
        >
          <Image
            source={require('../../assets/images/AppLogo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </Pressable>
        <Text style={styles.title}>Select Your City</Text>
        <Text style={styles.subtitle}>Choose the city you are working in</Text>
      </View>

      {error ? (
        <View style={styles.errorState}>
          <View style={styles.errorIcon}>
            <WifiOff size={24} color={colors.danger} />
          </View>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={load}>
            <RotateCcw size={16} color={colors.primary} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {/* Search */}
          <View style={styles.searchWrap}>
            <Search size={17} color={colors.faint} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search city…"
              placeholderTextColor={colors.faint}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
            />
            <Text style={styles.count}>{filtered.length}</Text>
          </View>

          {/* City list */}
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.key}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>No city found</Text>
              </View>
            }
            renderItem={({ item }) => {
              const active = selected === item.key;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.cityCard,
                    active && styles.cityCardActive,
                    pressed && styles.cityCardPressed,
                  ]}
                  onPress={() => setSelected(item.key)}
                >
                  <View style={[styles.cityIcon, active && styles.cityIconActive]}>
                    <MapPin size={16} color={active ? colors.white : colors.primary} />
                  </View>
                  <Text
                    style={[styles.cityName, active && styles.cityNameActive]}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {item.cityName}
                  </Text>
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active && <Check size={12} color={colors.white} strokeWidth={3} />}
                  </View>
                </Pressable>
              );
            }}
          />

          {/* Continue */}
          <View style={styles.footer}>
            <GradientButton
              label="CONTINUE"
              icon={<ArrowRight size={20} color={colors.white} />}
              disabled={!selected || !!connecting}
              loading={!!connecting}
              loadingLabel="Connecting…"
              onPress={handleContinue}
            />
          </View>
        </>
      )}

      {/* Mandatory permissions */}
      <ConfirmDialog
        visible={permDialog}
        icon={<ShieldAlert size={22} color={colors.primary} />}
        title="Permissions Required"
        message="Location and Camera access are mandatory to record field tasks. Please allow them to continue."
        confirmLabel="Try Again"
        cancelLabel="Settings"
        onConfirm={async () => {
          setPermDialog(false);
          const ok = await action.requestAppPermissions();
          if (!ok) setPermDialog(true);
        }}
        onCancel={() => {
          setPermDialog(false);
          action.openAppSettings();
        }}
      />

      <Loader
        visible={!!connecting}
        message={`Connecting to ${connecting}…`}
        transparent
      />
    </SafeAreaView>
  );
};

export default CitySelectionScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  orbTop: {
    position: 'absolute',
    top: -110,
    right: -70,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: colors.primary,
    opacity: 0.07,
  },

  header: { alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: spacing.xl },
  logoCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...shadow.sm,
  },
  logoPressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  logo: { width: 62, height: 62 },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink },
  subtitle: { fontSize: 12.5, color: colors.muted, marginTop: 3 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 46,
    marginHorizontal: spacing.xl,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.ink, padding: 0 },
  count: { fontSize: 12, fontWeight: '700', color: colors.primary },

  listContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  cityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  cityCardActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  cityCardPressed: { opacity: 0.85 },
  cityIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0, // never squeeze the icon for a long city name
  },
  cityIconActive: { backgroundColor: colors.primary },
  cityName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 20,
  },
  cityNameActive: { color: colors.primaryDark },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0, // keep the radio a perfect circle
  },
  radioActive: { backgroundColor: colors.primary, borderColor: colors.primary },

  empty: { alignItems: 'center', paddingVertical: spacing.xxxl },
  emptyText: { color: colors.muted, fontSize: 13 },

  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  errorIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: { fontSize: 13.5, color: colors.muted, textAlign: 'center', lineHeight: 19 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  retryText: { fontSize: 14, fontWeight: '700', color: colors.primary },

  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
});
