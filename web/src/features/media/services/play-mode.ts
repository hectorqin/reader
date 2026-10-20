/** How a playback queue advances once an entry ends. Shared by the engine and its controls. */
export type PlayMode='sequential'|'shuffle'|'repeat-one';
export const playModes:readonly PlayMode[]=['sequential','shuffle','repeat-one'];
export const playModeLabels:Readonly<Record<PlayMode,string>>={sequential:'顺序播放',shuffle:'随机','repeat-one':'单曲循环'};
