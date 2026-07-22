/**
 * Task form logic — media capture/pick, compression and submit validation.
 */
import { launchImageLibrary } from 'react-native-image-picker';
import { prepareImage, prepareVideo, getVideoThumbnail } from '../../services/mediaService';
import {
  submitTask as submitTaskToFirebase,
  getSelectableTasks,
} from '../../services/taskService';
import { storage } from '../../utils/storage';

export const MAX_IMAGES = 5;
export const MAX_VIDEOS = 2;

export const getHeaderTitle = (mode) =>
  mode === 'PICK' ? 'Task Execution' : mode === 'ADD_KPI' ? 'Add KPI Task' : 'Add Other Task';

/**
 * The tasks the user can choose from in an "Add …" form.
 * @param mode 'ADD_KPI' | 'ADD_OTHER'
 * @returns [{ id, title, type, priority, category, subKey? }]
 */
export const loadTaskOptions = async (mode) => {
  const user = await storage.getUser();
  if (!user?.userId) throw new Error('Not logged in');
  return getSelectableTasks(mode, user.userId);
};

/**
 * Compress a captured/picked asset.
 * Images → <= 50 KB. Videos → <= 15 MB plus a generated thumbnail.
 */
export const processMedia = async (type, uri) => {
  if (type === 'img') {
    const { uri: outUri, size } = await prepareImage(uri);
    return { uri: outUri, size };
  }
  const { uri: outUri, size } = await prepareVideo(uri);
  const thumb = await getVideoThumbnail(outUri);
  return { uri: outUri, size, thumb };
};

/** Open the system picker for up to `remaining` items. */
export const pickFromGallery = async (type, remaining) => {
  const res = await launchImageLibrary({
    mediaType: type === 'img' ? 'photo' : 'video',
    selectionLimit: remaining,
  });
  if (res?.didCancel) return [];
  return (res?.assets || []).filter((a) => a?.uri).slice(0, remaining);
};

/** @returns an error message, or '' when the form is submittable. */
export const validateTask = ({ selectedTask, images, videos, remark }) => {
  if (!selectedTask) return 'Please select a task';
  if (!images.length) return 'Please capture task image';
  if (!String(remark || '').trim()) return 'Please enter a remark';
  if (images.some((i) => i.processing) || videos.some((v) => v.processing)) {
    return 'Media is still processing, please wait';
  }
  return '';
};

/**
 * Submit the task to Firebase (record + media upload + priority status).
 * @param task   the picked task { id, subKey?, priority, category }
 * @param images [{ uri }] compressed images
 * @param videos [{ uri }] compressed videos
 * @param remark string
 */
export const submitTask = async ({ task, images, videos, remark }) => {
  await submitTaskToFirebase({ task, images, videos, remark });
  return true;
};
