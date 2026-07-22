const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

const config = {
  resolver: {
    // lucide-react-native (and other ESM packages) ship icons as .mjs;
    // Metro doesn't resolve .mjs by default.
    sourceExts: [...defaultConfig.resolver.sourceExts, 'mjs'],

    // Native build artifacts churn while Gradle runs (CMake creates and then
    // deletes temp dirs under android/.cxx). Metro's file watcher crashes with
    // ENOENT when a watched dir disappears, so keep them out of the file map.
    blockList: /.*[\\/](android[\\/](\.cxx|\.gradle|build)|ios[\\/](Pods|build))[\\/].*/,
  },
};

module.exports = mergeConfig(defaultConfig, config);
