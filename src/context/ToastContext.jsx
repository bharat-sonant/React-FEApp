import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Animated, StyleSheet, Text, View, Pressable } from 'react-native';
import { CheckCircle2, OctagonAlert, AlertCircle, Info, X } from 'lucide-react-native';
import { colors, radius, shadow, spacing } from '../theme/theme';

const ToastContext = createContext(null);

const CONFIG = {
  success: { color: colors.success, bg: '#ECFDF5', Icon: CheckCircle2 },
  error: { color: colors.danger, bg: '#FEF2F2', Icon: OctagonAlert },
  warning: { color: colors.warning, bg: '#FFFBEB', Icon: AlertCircle },
  info: { color: colors.info, bg: '#F0F9FF', Icon: Info },
};

const Toast = ({ toast, onHide }) => {
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const { color, bg, Icon } = CONFIG[toast.type] || CONFIG.success;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8, tension: 60 }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(hide, 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hide = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => onHide(toast.id));
  };

  return (
    <Animated.View
      style={[styles.toast, { transform: [{ translateY }], opacity }]}
    >
      <View style={[styles.iconBox, { backgroundColor: bg }]}>
        <Icon size={20} color={color} />
      </View>
      <Text style={styles.message} numberOfLines={2}>
        {toast.message}
      </Text>
      <Pressable hitSlop={8} onPress={hide} style={styles.close}>
        <X size={18} color={colors.faint} />
      </Pressable>
      <View style={[styles.accent, { backgroundColor: color }]} />
    </Animated.View>
  );
};

export const ToastProvider = ({ children }) => {
  const [toast, setToast] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ id: Date.now(), message, type });
  }, []);

  const hide = useCallback((id) => {
    setToast((prev) => (prev && prev.id === id ? null : prev));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <View pointerEvents="box-none" style={styles.host}>
          <Toast toast={toast} onHide={hide} />
        </View>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: spacing.xxxl + spacing.md,
    paddingHorizontal: spacing.lg,
    zIndex: 9999,
    alignItems: 'center',
  },
  toast: {
    width: '100%',
    maxWidth: 480,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
    overflow: 'hidden',
    ...shadow.lg,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    lineHeight: 18,
  },
  close: { padding: 2 },
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
});
