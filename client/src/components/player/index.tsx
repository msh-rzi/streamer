import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useStreamPlayer, type StreamPlayerControls } from './useStreamPlayer';

export type StreamPlayerHandle = StreamPlayerControls;

export type StreamPlayerProps = {
  backendUrl?: string;
  className?: string;
};

function formatTime(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';

  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);

  const paddedSeconds = seconds.toString().padStart(2, '0');
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${paddedSeconds}`;
  return `${minutes}:${paddedSeconds}`;
}

export const StreamPlayer = forwardRef<StreamPlayerHandle, StreamPlayerProps>(
  function StreamPlayer({ backendUrl, className }, ref) {
    const resolvedBackendUrl =
      backendUrl ?? import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3200';

    const [isScrubbing, setIsScrubbing] = useState(false);
    const [scrubTime, setScrubTime] = useState<number | null>(null);
    const scrubTimeRef = useRef(0);

    const { videoSrc, videoRef, containerRef, state, controls } = useStreamPlayer(
      { backendUrl: resolvedBackendUrl, isScrubbing },
    );

    useImperativeHandle(ref, () => controls, [controls]);

    const displayedTime = useMemo(() => {
      if (!isScrubbing || scrubTime === null) return state.currentTime;
      return scrubTime;
    }, [isScrubbing, scrubTime, state.currentTime]);

    const handleScrubStart = () => {
      setIsScrubbing(true);
      scrubTimeRef.current = state.currentTime;
      setScrubTime(state.currentTime);
    };

    const handleScrubChange = (value: number) => {
      scrubTimeRef.current = value;
      if (isScrubbing) {
        setScrubTime(value);
        controls.seekTo(value, { broadcast: false });
        return;
      }

      controls.seekTo(value, { broadcast: true });
    };

    const handleScrubEnd = () => {
      setIsScrubbing(false);
      const finalTime = scrubTimeRef.current;
      setScrubTime(null);
      controls.seekTo(finalTime, { broadcast: true });
    };

    const timeMax = Math.max(0, state.duration || 0);

    return (
      <div
        ref={containerRef}
        className={cn(
          'relative w-full overflow-hidden rounded-xl bg-black shadow-sm',
          className,
        )}
      >
        <video
          ref={videoRef}
          className="aspect-video w-full bg-black"
          src={videoSrc}
          crossOrigin="anonymous"
          playsInline
          preload="metadata"
          onClick={() => void controls.togglePlay({ broadcast: true })}
        />

        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">
          <span
            className={cn(
              'inline-block size-2 rounded-full',
              state.isSocketConnected ? 'bg-emerald-400' : 'bg-rose-400',
            )}
          />
          <span className="opacity-90">
            {state.isSocketConnected ? 'socket connected' : 'socket disconnected'}
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent p-3">
          <div className="pointer-events-auto flex flex-col gap-2">
            <input
              className="h-2 w-full cursor-pointer accent-white"
              type="range"
              min={0}
              max={timeMax}
              step={0.05}
              value={Math.min(displayedTime, timeMax)}
              onPointerDown={handleScrubStart}
              onPointerUp={handleScrubEnd}
              onChange={(e) => handleScrubChange(Number(e.target.value))}
              aria-label="Seek"
            />

            <div className="flex items-center justify-between gap-3 text-white">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => void controls.togglePlay({ broadcast: true })}
                  aria-label={state.isPlaying ? 'Pause' : 'Play'}
                >
                  {state.isPlaying ? <Pause /> : <Play />}
                </Button>

                <div className="text-xs tabular-nums opacity-90">
                  {formatTime(displayedTime)} / {formatTime(state.duration)}
                </div>

                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => controls.toggleMute()}
                  aria-label={state.muted ? 'Unmute' : 'Mute'}
                >
                  {state.muted || state.volume === 0 ? <VolumeX /> : <Volume2 />}
                </Button>

                <input
                  className="h-2 w-24 cursor-pointer accent-white"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={state.muted ? 0 : state.volume}
                  onChange={(e) => controls.setVolume(Number(e.target.value))}
                  aria-label="Volume"
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => controls.toggleFullscreen()}
                  aria-label={state.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                >
                  {state.isFullscreen ? <Minimize /> : <Maximize />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

export default StreamPlayer;
