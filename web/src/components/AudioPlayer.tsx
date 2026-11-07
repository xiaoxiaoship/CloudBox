import { useEffect, useRef, useState } from 'react';
import { previewContentUrl } from '../api/client.ts';
import { useAppStore } from '../store/useAppStore.ts';

function titleOf(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function AudioPlayer() {
  const queue = useAppStore((state) => state.audioQueue);
  const index = useAppStore((state) => state.audioIndex);
  const open = useAppStore((state) => state.audioOpen);
  const playing = useAppStore((state) => state.audioPlaying);
  const toggle = useAppStore((state) => state.toggleAudio);
  const next = useAppStore((state) => state.nextAudio);
  const prev = useAppStore((state) => state.prevAudio);
  const close = useAppStore((state) => state.closeAudio);
  const setIndex = useAppStore((state) => state.setAudioIndex);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  const track = queue[index] ?? null;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    audio.src = previewContentUrl(track.path);
    audio.load();
    setCurrent(0);
    setDuration(0);
    if (playing) void audio.play().catch(() => {});
  }, [track?.path]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) void audio.play().catch(() => {});
    else audio.pause();
  }, [playing]);

  if (!open || !track) return null;

  return (
    <>
      <div className="fixed bottom-4 left-4 right-4 z-30 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:right-24">
        <audio
          ref={audioRef}
          preload="metadata"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
          onEnded={() => next()}
        />
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xl text-white shadow">
            ♪
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{titleOf(track.name)}</p>
            <p className="text-[11px] text-slate-400">未知歌手 · CloudBox Music</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="w-9 text-right text-[10px] text-slate-400">{formatTime(current)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(current, duration || 0)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setCurrent(value);
                  if (audioRef.current) audioRef.current.currentTime = value;
                }}
                className="h-1 flex-1 accent-indigo-500"
                aria-label="播放进度"
              />
              <span className="w-9 text-[10px] text-slate-400">{formatTime(duration)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={prev} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="上一首">⏮</button>
            <button type="button" onClick={toggle} className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-lg text-white shadow hover:bg-indigo-500" aria-label={playing ? '暂停' : '播放'}>{playing ? '⏸' : '▶'}</button>
            <button type="button" onClick={next} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="下一首">⏭</button>
            <button type="button" onClick={() => setPlaylistOpen((value) => !value)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="查看播放列表">☰</button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              className="hidden h-1 w-20 accent-indigo-500 sm:block"
              aria-label="音量"
            />
            <button type="button" onClick={close} className="rounded-full p-2 text-slate-400 hover:text-rose-500" aria-label="关闭播放器">×</button>
          </div>
        </div>
      </div>

      {playlistOpen ? (
        <aside className="fixed bottom-24 right-4 z-30 w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">播放列表</p>
            <span className="text-[11px] text-slate-400">{queue.length} 首</span>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {queue.map((item, itemIndex) => (
              <button
                key={`${item.path}-${itemIndex}`}
                type="button"
                onClick={() => setIndex(itemIndex)}
                className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs ${itemIndex === index ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {itemIndex + 1}. {titleOf(item.name)}
              </button>
            ))}
          </div>
        </aside>
      ) : null}
    </>
  );
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}
