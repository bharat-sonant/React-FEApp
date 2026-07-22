import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Images,
  PlayCircle,
  Video as VideoIcon,
  X,
} from 'lucide-react-native';
import AppHeader from '../../components/AppHeader';
import GradientButton from '../../components/GradientButton';
import ActionSheet from '../../components/ActionSheet';
import TaskPickerSheet from '../../components/TaskPickerSheet';
import Loader from '../../components/Loader';
import { useToast } from '../../context/ToastContext';
import { setCaptureHandler, clearCaptureHandler } from '../../utils/captureBridge';
import {
  prepareImage,
  prepareVideo,
  getVideoThumbnail,
  formatBytes,
} from '../../services/mediaService';
import { submitTask, loadTaskOptions } from '../../Action/TaskForm/TaskForm_Action';
import { colors, radius, spacing } from '../../theme/theme';

const MAX_IMAGES = 5;
const MAX_VIDEOS = 2;

// Size tiles so all 5 photos fit comfortably on one row.
const GRID_GAP = spacing.sm;
const { width: SCREEN_W } = Dimensions.get('window');
const TILE = Math.floor((SCREEN_W - spacing.lg * 4 - GRID_GAP * 4) / 5);

/** Marks a field the submit validation actually enforces. */
const Required = () => <Text style={styles.required}> *</Text>;

const OptionalTag = () => (
  <View style={styles.optionalTag}>
    <Text style={styles.optionalText}>Optional</Text>
  </View>
);

const MediaTile = ({ item, isVideoTile, onRemove, onOpen }) => {
  // Videos show their generated thumbnail; fall back to a play placeholder.
  const thumbUri = isVideoTile ? item.thumb : item.uri;

  return (
    <Pressable
      style={styles.tile}
      onPress={() => !item.processing && onOpen(item)}
      disabled={item.processing}
    >
      {thumbUri ? (
        <Image source={{ uri: thumbUri }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.videoThumb]}>
          <PlayCircle size={18} color={colors.white} />
        </View>
      )}

      {isVideoTile && !!thumbUri && (
        <View style={styles.playOverlay} pointerEvents="none">
          <PlayCircle size={18} color={colors.white} />
        </View>
      )}

      {item.processing ? (
        <View style={styles.processing}>
          <Loader inline bare size={24} />
        </View>
      ) : (
        <>
          <View style={styles.sourceBadge}>
            {item.source === 'camera' ? (
              <Camera size={8} color={colors.white} />
            ) : (
              <Images size={8} color={colors.white} />
            )}
          </View>
          <Pressable style={styles.deleteBtn} onPress={() => onRemove(item.id)} hitSlop={8}>
            <X size={9} color={colors.white} strokeWidth={3} />
          </Pressable>
        </>
      )}
    </Pressable>
  );
};

const TaskExecutionScreen = ({ navigation, route }) => {
  const { showToast } = useToast();
  const { mode = 'PICK', taskData = null } = route.params || {};

  const isPick = mode === 'PICK';
  const headerTitle = isPick
    ? 'Task Execution'
    : mode === 'ADD_KPI'
    ? 'Add KPI Task'
    : 'Add Other Task';

  // The task being submitted: fixed for PICK, chosen from the list for ADD_*.
  const [selected, setSelected] = useState(isPick ? taskData : null);
  const [options, setOptions] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(!isPick);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [images, setImages] = useState([]);
  const [videos, setVideos] = useState([]);
  const [remark, setRemark] = useState('');
  const [remarkFocused, setRemarkFocused] = useState(false);
  const [sheet, setSheet] = useState(null); // 'img' | 'vid' | null
  const [viewer, setViewer] = useState(null); // { type, uri }
  const [submitting, setSubmitting] = useState(false);

  const idRef = useRef(0);
  const makeId = () => `${++idRef.current}-${Date.now()}`;

  // ADD_KPI / ADD_OTHER: load the tasks the user can pick from.
  useEffect(() => {
    if (isPick) return undefined;
    let alive = true;
    loadTaskOptions(mode)
      .then((list) => alive && setOptions(list))
      .catch((e) => alive && showToast(e?.message || 'Could not load tasks', 'error'))
      .finally(() => alive && setOptionsLoading(false));
    return () => {
      alive = false;
    };
  }, [isPick, mode, showToast]);

  // Mirror list lengths in refs so capacity checks never read a stale closure.
  const imagesRef = useRef([]);
  const videosRef = useRef([]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(() => {
    videosRef.current = videos;
  }, [videos]);

  /**
   * Adds media optimistically (with a spinner), then swaps in the compressed
   * result: images -> <=50KB, videos -> <=15MB + a generated thumbnail.
   */
  const addMedia = useCallback(
    async (type, source, uri) => {
      const isImg = type === 'img';
      const max = isImg ? MAX_IMAGES : MAX_VIDEOS;
      const setter = isImg ? setImages : setVideos;
      const listRef = isImg ? imagesRef : videosRef;

      if (listRef.current.length >= max) return;

      const id = makeId();
      setter((p) =>
        p.length >= max ? p : [...p, { id, type, source, uri, processing: true }],
      );

      try {
        if (isImg) {
          const { uri: outUri, size } = await prepareImage(uri);
          setter((p) =>
            p.map((x) => (x.id === id ? { ...x, uri: outUri, size, processing: false } : x)),
          );
        } else {
          const { uri: outUri, size } = await prepareVideo(uri);
          const thumb = await getVideoThumbnail(outUri);
          setter((p) =>
            p.map((x) =>
              x.id === id ? { ...x, uri: outUri, size, thumb, processing: false } : x,
            ),
          );
        }
      } catch (err) {
        // Drop the placeholder and tell the user why
        setter((p) => p.filter((x) => x.id !== id));
        showToast(err?.message || 'Could not process media', 'error');
      }
    },
    [showToast],
  );

  // Receive media captured by CameraScreen (see utils/captureBridge)
  useEffect(() => {
    setCaptureHandler((m) => addMedia(m.type, m.source, m.uri));
    return clearCaptureHandler;
  }, [addMedia]);

  const removeImage = (id) => setImages((p) => p.filter((x) => x.id !== id));
  const removeVideo = (id) => setVideos((p) => p.filter((x) => x.id !== id));

  const pickFromGallery = async (type) => {
    // Allow picking as many as there are free slots left.
    const remaining =
      type === 'img' ? MAX_IMAGES - images.length : MAX_VIDEOS - videos.length;
    if (remaining <= 0) {
      showToast(
        `You can add up to ${type === 'img' ? MAX_IMAGES : MAX_VIDEOS} ${
          type === 'img' ? 'photos' : 'videos'
        }`,
        'warning',
      );
      return;
    }

    const res = await launchImageLibrary({
      mediaType: type === 'img' ? 'photo' : 'video',
      selectionLimit: remaining,
    });
    if (res?.didCancel) return;

    const assets = (res?.assets || []).filter((a) => a?.uri);
    assets.slice(0, remaining).forEach((a) => addMedia(type, 'gallery', a.uri));

    if (assets.length > remaining) {
      showToast(`Only ${remaining} more could be added`, 'info');
    }
  };

  const openCamera = (type) => navigation.navigate('Camera', { mediaType: type });

  const handleSubmit = async () => {
    if (!selected?.id) return showToast('Please select a task', 'warning');
    if (images.length === 0) return showToast('Please capture task image', 'warning');
    if (!remark.trim()) return showToast('Please enter a remark', 'warning');
    if (images.some((i) => i.processing) || videos.some((v) => v.processing)) {
      return showToast('Media is still processing, please wait', 'warning');
    }

    setSubmitting(true);
    try {
      await submitTask({ task: selected, images, videos, remark });
      showToast('Task submitted successfully!', 'success');
      // Tell the dashboard which task landed, so its card flips to "Completed"
      // right away instead of waiting for the next sync.
      setTimeout(() => {
        navigation.navigate('Dashboard', {
          submitted: {
            id: selected.id,
            priority: selected.priority,
            title: selected.title,
            subKey: selected.subKey ?? null,
            // Needed to render a card for an added (unassigned) task.
            type: selected.type,
            category: selected.category,
          },
        });
      }, 400);
    } catch (e) {
      showToast(e?.message || 'Could not submit the task', 'error');
    } finally {
      setSubmitting(false);
    }
    return undefined;
  };

  const sheetOptions =
    sheet === 'img'
      ? [
          {
            key: 'cam',
            label: 'Take Photo',
            sublabel: 'Capture with camera',
            icon: <Camera size={20} color={colors.primary} />,
            onPress: () => openCamera('img'),
          },
          {
            key: 'gal',
            label: 'Choose from Gallery',
            sublabel: `Select up to ${MAX_IMAGES - images.length} photo${
              MAX_IMAGES - images.length === 1 ? '' : 's'
            }`,
            icon: <Images size={20} color={colors.primary} />,
            onPress: () => pickFromGallery('img'),
          },
        ]
      : [
          {
            key: 'rec',
            label: 'Record Video',
            sublabel: 'Capture with camera',
            icon: <VideoIcon size={20} color={colors.primary} />,
            onPress: () => openCamera('vid'),
          },
          {
            key: 'gal',
            label: 'Choose from Gallery',
            sublabel: `Select up to ${MAX_VIDEOS - videos.length} video${
              MAX_VIDEOS - videos.length === 1 ? '' : 's'
            }`,
            icon: <Images size={20} color={colors.primary} />,
            onPress: () => pickFromGallery('vid'),
          },
        ];

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />
      <AppHeader title={headerTitle} showBack onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.legend}>
          <Text style={styles.legendText}>
            <Text style={styles.required}>*</Text> Required fields
          </Text>
        </View>

        {/* Task selection */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            Task
            <Required />
          </Text>
          {isPick ? (
            <View style={styles.readonlyBox}>
              <View style={styles.readonlyIcon}>
                <FileText size={16} color={colors.primary} />
              </View>
              <View style={styles.readonlyInfo}>
                <Text style={styles.readonlyTitle} numberOfLines={1}>{selected?.title}</Text>
                <Text style={styles.readonlySub}>Assigned · Read-only</Text>
              </View>
              <CheckCircle2 size={18} color={colors.primary} />
            </View>
          ) : (
            <Pressable
              style={[styles.selectTrigger, dropdownOpen && styles.selectTriggerActive]}
              onPress={() => setDropdownOpen(true)}
              disabled={optionsLoading}
            >
              <Text style={[styles.selectText, !selected && styles.selectPlaceholder]} numberOfLines={1}>
                {optionsLoading ? 'Loading tasks…' : selected?.title || 'Choose a task…'}
              </Text>
              {optionsLoading ? (
                <Loader inline bare size={20} />
              ) : (
                <ChevronDown size={18} color={colors.muted} />
              )}
            </Pressable>
          )}
        </View>

        {/* Photos */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={styles.sectionHeadLeft}>
              <ImageIcon size={15} color={colors.muted} />
              <Text style={styles.sectionLabel}>
                Photos
                <Required />
              </Text>
            </View>
            <Text style={styles.count}>{images.length}/{MAX_IMAGES}</Text>
          </View>
          <View style={styles.grid}>
            {images.map((img) => (
              <MediaTile key={img.id} item={img} onRemove={removeImage} onOpen={setViewer} />
            ))}
            {images.length < MAX_IMAGES && (
              <Pressable style={styles.addTile} onPress={() => setSheet('img')}>
                <Camera size={16} color={colors.primary} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Videos */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={styles.sectionHeadLeft}>
              <VideoIcon size={15} color={colors.muted} />
              <Text style={styles.sectionLabel}>Videos</Text>
              <OptionalTag />
            </View>
            <Text style={styles.count}>{videos.length}/{MAX_VIDEOS}</Text>
          </View>
          <View style={styles.grid}>
            {videos.map((vid) => (
              <MediaTile key={vid.id} item={vid} isVideoTile onRemove={removeVideo} onOpen={setViewer} />
            ))}
            {videos.length < MAX_VIDEOS && (
              <Pressable style={styles.addTile} onPress={() => setSheet('vid')}>
                <VideoIcon size={16} color={colors.primary} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Remarks */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            Remarks
            <Required />
          </Text>
          <TextInput
            style={[styles.textArea, remarkFocused && styles.textAreaFocused]}
            placeholder="Add your observations or completion notes…"
            placeholderTextColor={colors.faint}
            value={remark}
            onChangeText={setRemark}
            onFocus={() => setRemarkFocused(true)}
            onBlur={() => setRemarkFocused(false)}
            multiline
            textAlignVertical="top"
          />
        </View>
      </ScrollView>

      {/* Footer */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable style={styles.cancelBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <GradientButton label="Submit" onPress={handleSubmit} style={styles.submitBtn} />
      </SafeAreaView>

      <ActionSheet
        visible={sheet !== null}
        title={sheet === 'img' ? 'Add Photo' : 'Add Video'}
        options={sheetOptions}
        onClose={() => setSheet(null)}
      />

      <TaskPickerSheet
        visible={dropdownOpen}
        title={mode === 'ADD_KPI' ? 'Select KPI Task' : 'Select Task'}
        options={options}
        selected={selected}
        onSelect={setSelected}
        onClose={() => setDropdownOpen(false)}
      />

      <Loader visible={submitting} message="Submitting task…" transparent />

      {/* Full-screen media viewer */}
      <Modal
        visible={viewer !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewer(null)}
        statusBarTranslucent
      >
        <View style={styles.viewerRoot}>
          <StatusBar barStyle="light-content" backgroundColor="#000" />
          {viewer?.type === 'vid' ? (
            <View style={styles.viewerVideo}>
              {viewer?.thumb && (
                <Image
                  source={{ uri: viewer.thumb }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                />
              )}
              <PlayCircle size={54} color={colors.white} />
              <Text style={styles.viewerVideoText}>Video attached</Text>
            </View>
          ) : (
            <Image source={{ uri: viewer?.uri }} style={styles.viewerImage} resizeMode="contain" />
          )}
          {!!viewer?.size && (
            <View style={styles.viewerSize}>
              <Text style={styles.viewerSizeText}>{formatBytes(viewer.size)}</Text>
            </View>
          )}
          <SafeAreaView edges={['top']} style={styles.viewerBar}>
            <Pressable style={styles.viewerClose} onPress={() => setViewer(null)} hitSlop={10}>
              <X size={22} color={colors.white} />
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
};

export default TaskExecutionScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  count: { fontSize: 12, fontWeight: '600', color: colors.primary },
  required: { color: colors.danger, fontWeight: '700' },
  legend: { paddingHorizontal: spacing.xs, marginBottom: -spacing.xs },
  legendText: { fontSize: 11, color: colors.muted, fontWeight: '500' },
  optionalTag: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  optionalText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  readonlyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  readonlyIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readonlyInfo: { flex: 1 },
  readonlyTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  readonlySub: { fontSize: 11, color: colors.muted, marginTop: 1 },

  selectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 46,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
    marginTop: spacing.sm,
  },
  selectTriggerActive: { borderColor: colors.primary, backgroundColor: colors.surface },
  selectText: { fontSize: 14, color: colors.ink },
  selectPlaceholder: { color: colors.faint },
  // Media grid — compact tiles so all 5 fit on one row
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  tile: { width: TILE, height: TILE },
  thumb: {
    width: TILE,
    height: TILE,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  videoThumb: {
    backgroundColor: colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: radius.sm,
  },
  processing: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,23,42,0.55)',
    borderRadius: radius.sm,
  },
  sourceBadge: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(15,23,42,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  addTile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primaryLight,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },

  textArea: {
    minHeight: 96,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.surfaceAlt,
    marginTop: spacing.sm,
  },
  textAreaFocused: { borderColor: colors.primary, backgroundColor: colors.surface },

  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelBtn: {
    flex: 1,
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  cancelText: { fontSize: 15, fontWeight: '600', color: colors.text },
  submitBtn: { flex: 1.4 },

  // Viewer
  viewerRoot: { flex: 1, backgroundColor: '#000' },
  viewerImage: { flex: 1 },
  viewerVideo: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  viewerVideoText: { color: colors.white, fontSize: 14, fontWeight: '600' },
  viewerBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    alignItems: 'flex-end',
  },
  viewerClose: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerSize: {
    position: 'absolute',
    bottom: spacing.xxl,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  viewerSizeText: { color: colors.white, fontSize: 12, fontWeight: '600' },
});
