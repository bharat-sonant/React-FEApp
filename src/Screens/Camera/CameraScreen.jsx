import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
} from 'react-native-vision-camera';
import {
  Check,
  RotateCcw,
  SwitchCamera,
  X,
  Zap,
  ZapOff,
} from 'lucide-react-native';
import Loader from '../../components/Loader';
import { emitCapture } from '../../utils/captureBridge';
import { colors, radius, spacing } from '../../theme/theme';

/**
 * Full-screen custom camera (react-native-vision-camera v5 / Nitro API).
 * route.params: { mediaType: 'img' | 'vid' }
 * On confirm, emits the media via captureBridge and pops back.
 */
const CameraScreen = ({ navigation, route }) => {
  const mediaType = route.params?.mediaType || 'img';
  const isVideo = mediaType === 'vid';

  const cameraRef = useRef(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const mic = useMicrophonePermission();

  const [position, setPosition] = useState('back');
  const [flash, setFlash] = useState('off'); // 'off' | 'on'
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState(null); // { type, uri }
  const [camError, setCamError] = useState(null);

  const device = useCameraDevice(position);

  const focusRing = useRef(new Animated.Value(0)).current;
  const [focusPoint, setFocusPoint] = useState(null);

  // Keep the session alive only while focused + foregrounded
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);
  const cameraActive = isFocused && appActive && !preview;

  useEffect(() => {
    if (!hasPermission) Promise.resolve(requestPermission()).catch(() => {});
    if (isVideo && !mic.hasPermission) Promise.resolve(mic.requestPermission()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const showFocus = useCallback(
    (x, y) => {
      setFocusPoint({ x, y });
      focusRing.setValue(0);
      Animated.sequence([
        Animated.timing(focusRing, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(focusRing, { toValue: 0, duration: 500, delay: 400, useNativeDriver: true }),
      ]).start(() => setFocusPoint(null));
    },
    [focusRing],
  );

  const handleFocus = (e) => {
    const { locationX, locationY } = e.nativeEvent;
    showFocus(locationX, locationY);
    // Focus only while the session is live — CameraControl throws
    // "Camera is not active" otherwise. Never let it reject unhandled.
    if (!cameraActive || !device?.supportsFocus) return;
    Promise.resolve(cameraRef.current?.focus({ x: locationX, y: locationY })).catch(
      () => {},
    );
  };

  const takePhoto = async () => {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePhoto({ flash });
      setPreview({ type: 'img', uri: `file://${photo.path}` });
    } catch (err) {
      setCamError(err?.message || 'Could not capture photo');
    } finally {
      setBusy(false);
    }
  };

  const toggleRecord = async () => {
    if (busy || !cameraRef.current) return;

    if (recording) {
      setBusy(true);
      try {
        await cameraRef.current.stopRecording();
      } catch (err) {
        setCamError(err?.message || 'Could not stop recording');
        setRecording(false);
      } finally {
        setBusy(false);
      }
      return;
    }

    try {
      setSeconds(0);
      setRecording(true);
      cameraRef.current.startRecording({
        flash,
        onRecordingFinished: (video) => {
          setRecording(false);
          setPreview({ type: 'vid', uri: `file://${video.path}` });
        },
        onRecordingError: (error) => {
          setRecording(false);
          setCamError(error?.message || 'Recording failed');
        },
      });
    } catch (err) {
      setRecording(false);
      setCamError(err?.message || 'Could not start recording');
    }
  };

  const confirm = () => {
    // Hand the media over via the bridge, then simply pop this screen — the
    // Task form stays mounted so its media list keeps accumulating.
    emitCapture({ type: preview.type, uri: preview.uri, source: 'camera' });
    navigation.goBack();
  };

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

  // ---- Gates ----
  if (!hasPermission) {
    return (
      <View style={styles.gate}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <Text style={styles.gateTitle}>Camera permission needed</Text>
        <Text style={styles.gateText}>Allow camera access to capture task media.</Text>
        <Pressable style={styles.gateBtn} onPress={requestPermission}>
          <Text style={styles.gateBtnText}>Grant Permission</Text>
        </Pressable>
        <Pressable onPress={() => navigation.goBack()} style={styles.gateback}>
          <Text style={styles.gateBackText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (camError) {
    return (
      <View style={styles.gate}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <Text style={styles.gateTitle}>Camera error</Text>
        <Text style={styles.gateText}>{camError}</Text>
        <Pressable style={styles.gateBtn} onPress={() => setCamError(null)}>
          <Text style={styles.gateBtnText}>Retry</Text>
        </Pressable>
        <Pressable onPress={() => navigation.goBack()} style={styles.gateback}>
          <Text style={styles.gateBackText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.gate}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <Loader inline bare size={44} />
        <Text style={[styles.gateText, { marginTop: spacing.md }]}>No camera available</Text>
        <Pressable onPress={() => navigation.goBack()} style={styles.gateback}>
          <Text style={styles.gateBackText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  // ---- Preview ----
  if (preview) {
    return (
      <View style={styles.previewRoot}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        {preview.type === 'img' ? (
          <Image source={{ uri: preview.uri }} style={styles.previewMedia} resizeMode="contain" />
        ) : (
          <View style={[styles.previewMedia, styles.videoPlaceholder]}>
            <Text style={styles.videoTagText}>Video recorded</Text>
          </View>
        )}
        <SafeAreaView edges={['bottom']} style={styles.previewBar}>
          <Pressable style={styles.retakeBtn} onPress={() => setPreview(null)}>
            <RotateCcw size={18} color={colors.white} />
            <Text style={styles.retakeText}>Retake</Text>
          </Pressable>
          <Pressable style={styles.useBtn} onPress={confirm}>
            <Check size={18} color={colors.white} />
            <Text style={styles.useText}>Use {preview.type === 'vid' ? 'Video' : 'Photo'}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  // ---- Live camera ----
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <Pressable style={StyleSheet.absoluteFill} onPress={handleFocus}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={cameraActive}
          photo={!isVideo}
          video={isVideo}
          audio={isVideo && mic.hasPermission}
          // Torch is only the continuous light for video; photo flash is passed
          // to takePhoto(). Only touch it while the session is live.
          torch={isVideo && cameraActive && flash === 'on' ? 'on' : 'off'}
          onError={(e) => setCamError(e?.message || 'Camera could not be started')}
        />
      </Pressable>

      {focusPoint && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.focusRing,
            {
              left: focusPoint.x - 32,
              top: focusPoint.y - 32,
              opacity: focusRing,
              transform: [{ scale: focusRing.interpolate({ inputRange: [0, 1], outputRange: [1.3, 1] }) }],
            },
          ]}
        />
      )}

      <SafeAreaView edges={['top']} style={styles.topBar}>
        <Pressable style={styles.circleBtn} onPress={() => navigation.goBack()} hitSlop={8}>
          <X size={22} color={colors.white} />
        </Pressable>
        <View style={styles.modePill}>
          <Text style={styles.modePillText}>{isVideo ? 'VIDEO' : 'PHOTO'}</Text>
        </View>
        <Pressable
          style={styles.circleBtn}
          onPress={() => setFlash((f) => (f === 'on' ? 'off' : 'on'))}
          hitSlop={8}
        >
          {flash === 'on' ? <Zap size={22} color="#FCD34D" /> : <ZapOff size={22} color={colors.white} />}
        </Pressable>
      </SafeAreaView>

      {recording && (
        <View style={styles.recPill}>
          <View style={styles.recDot} />
          <Text style={styles.recText}>{mmss}</Text>
        </View>
      )}

      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <View style={styles.bottomSide}>
          {!recording && (
            <Pressable
              style={styles.circleBtn}
              onPress={() => setPosition((p) => (p === 'back' ? 'front' : 'back'))}
              hitSlop={8}
            >
              <SwitchCamera size={24} color={colors.white} />
            </Pressable>
          )}
        </View>

        <Pressable onPress={isVideo ? toggleRecord : takePhoto} disabled={busy}>
          <View style={[styles.shutterOuter, isVideo && styles.shutterOuterVid]}>
            {busy ? (
              <Loader inline bare size={34} />
            ) : isVideo ? (
              <View style={[styles.shutterInnerVid, recording && styles.shutterInnerRec]} />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </View>
        </Pressable>

        <View style={styles.bottomSide} />
      </SafeAreaView>
    </View>
  );
};

export default CameraScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  circleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modePill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  modePillText: { color: colors.white, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },

  recPill: {
    position: 'absolute',
    top: 90,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  recText: { color: colors.white, fontSize: 13, fontWeight: '600' },

  focusRing: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },

  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.md,
    paddingTop: spacing.lg,
  },
  bottomSide: { width: 60, alignItems: 'center' },

  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterOuterVid: { borderColor: 'rgba(239,68,68,0.9)' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.white },
  shutterInnerVid: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.danger },
  shutterInnerRec: { width: 30, height: 30, borderRadius: 6 },

  // Preview
  previewRoot: { flex: 1, backgroundColor: '#000' },
  previewMedia: { flex: 1 },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  videoTagText: { color: colors.white, fontSize: 14, fontWeight: '600' },
  previewBar: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: '#000',
  },
  retakeBtn: {
    flex: 1,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  retakeText: { color: colors.white, fontSize: 15, fontWeight: '600' },
  useBtn: {
    flex: 1.4,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  useText: { color: colors.white, fontSize: 15, fontWeight: '700' },

  // Gates
  gate: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  gateTitle: { color: colors.white, fontSize: 18, fontWeight: '700', marginBottom: spacing.sm },
  gateText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },
  gateBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  gateBtnText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  gateback: { marginTop: spacing.lg },
  gateBackText: { color: 'rgba(255,255,255,0.6)', fontSize: 14 },
});
