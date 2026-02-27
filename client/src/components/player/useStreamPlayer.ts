import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type SyncState = {
  isPlaying: boolean;
  currentTime: number;
  serverTimeMs?: number;
};

const FORCE_SYNC_THRESHOLD_SECONDS = 0.1;
const PLAYER_SYNC_CHECK_INTERVAL_MS = 2000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getAudioContextCtor():
  | (new (contextOptions?: AudioContextOptions) => AudioContext)
  | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window.AudioContext ?? (window as any).webkitAudioContext) ?? null;
}

export type StreamPlayerState = {
  isSocketConnected: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  isFullscreen: boolean;
  isPiP: boolean;
};

export type StreamPlayerControls = {
  play: (opts?: { broadcast?: boolean }) => Promise<void>;
  pause: (opts?: { broadcast?: boolean }) => void;
  togglePlay: (opts?: { broadcast?: boolean }) => Promise<void>;
  seekTo: (time: number, opts?: { broadcast?: boolean }) => void;
  seekBy: (delta: number, opts?: { broadcast?: boolean }) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
  toggleFullscreen: () => void;
  enterPiP: () => Promise<void>;
  exitPiP: () => Promise<void>;
  togglePiP: () => Promise<void>;
  sync: () => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, '');
}

export function useStreamPlayer({
  backendUrl,
  isScrubbing,
}: {
  backendUrl: string;
  isScrubbing?: boolean;
}) {
  const normalizedBackendUrl = useMemo(
    () => trimTrailingSlashes(backendUrl),
    [backendUrl],
  );
  const videoSrc = useMemo(
    () => `${normalizedBackendUrl}/video`,
    [normalizedBackendUrl],
  );

  const socketRef = useRef<Socket | null>(null);
  const lastSyncStateRef = useRef<
    | (SyncState & {
        receivedAtMs: number;
      })
    | null
  >(null);

  const isScrubbingRef = useRef(false);
  useEffect(() => {
    isScrubbingRef.current = Boolean(isScrubbing);
  }, [isScrubbing]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const isWebAudioActiveRef = useRef(false);

  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(
    null,
  );

  const containerElementRef = useRef<HTMLDivElement | null>(null);

  const durationRef = useRef(0);

  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);

  const ensureWebAudio = useCallback(() => {
    if (isWebAudioActiveRef.current) return true;

    const video = videoElementRef.current;
    if (!video) return false;

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) return false;

    try {
      const context = audioContextRef.current ?? new AudioContextCtor();
      audioContextRef.current = context;

      const gain = audioGainRef.current ?? context.createGain();
      audioGainRef.current = gain;

      const source =
        audioSourceRef.current ?? context.createMediaElementSource(video);
      audioSourceRef.current = source;

      source.connect(gain);
      gain.connect(context.destination);

      isWebAudioActiveRef.current = true;
      return true;
    } catch {
      return false;
    }
  }, []);

  const applyAudioSettings = useCallback(
    (nextVolume: number, nextMuted: boolean) => {
      const video = videoElementRef.current;
      if (!video) return;

      if (ensureWebAudio()) {
        const gain = audioGainRef.current;
        video.volume = 1;
        video.muted = nextMuted;
        if (gain) gain.gain.value = nextMuted ? 0 : nextVolume;

        const context = audioContextRef.current;
        if (context?.state === 'suspended') {
          void context.resume().catch(() => undefined);
        }
        return;
      }

      video.volume = nextVolume;
      video.muted = nextMuted;
    },
    [ensureWebAudio],
  );

  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    videoElementRef.current = node;
    setVideoElement(node);
  }, []);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerElementRef.current = node;
  }, []);

  const seekTo = useCallback<StreamPlayerControls['seekTo']>((time, opts) => {
    const video = videoElementRef.current;
    if (!video) return;

    const clampedTime = clamp(time, 0, durationRef.current || time);
    video.currentTime = clampedTime;

    const broadcast = opts?.broadcast ?? true;
    if (broadcast) socketRef.current?.emit('seek', clampedTime);
  }, []);

  const seekBy = useCallback<StreamPlayerControls['seekBy']>(
    (delta, opts) => {
      const video = videoElementRef.current;
      if (!video) return;

      seekTo(video.currentTime + delta, opts);
    },
    [seekTo],
  );

  const pause = useCallback<StreamPlayerControls['pause']>((opts) => {
    const video = videoElementRef.current;
    if (!video) return;

    video.pause();
    const broadcast = opts?.broadcast ?? true;
    if (broadcast) socketRef.current?.emit('pause', video.currentTime);
  }, []);

  const play = useCallback<StreamPlayerControls['play']>(
    async (opts) => {
      const video = videoElementRef.current;
      if (!video) return;

      try {
        await video.play();
      } catch {
        // Autoplay restrictions or other playback errors.
        return;
      }

      const broadcast = opts?.broadcast ?? true;
      if (broadcast) socketRef.current?.emit('play', video.currentTime);
    },
    [],
  );

  const togglePlay = useCallback<StreamPlayerControls['togglePlay']>(
    async (opts) => {
      const video = videoElementRef.current;
      if (!video) return;

      if (video.paused) {
        await play(opts);
        return;
      }

      pause(opts);
    },
    [pause, play],
  );

  const setVolume = useCallback<StreamPlayerControls['setVolume']>((value) => {
    const nextVolume = clamp(value, 0, 1);

    const nextMuted = nextVolume > 0 ? false : muted;
    setVolumeState(nextVolume);
    if (nextMuted !== muted) setMutedState(nextMuted);

    applyAudioSettings(nextVolume, nextMuted);
  }, [applyAudioSettings, muted]);

  const setMuted = useCallback<StreamPlayerControls['setMuted']>((value) => {
    setMutedState(value);
    applyAudioSettings(volume, value);
  }, [applyAudioSettings, volume]);

  const toggleMute = useCallback<StreamPlayerControls['toggleMute']>(() => {
    const nextMuted = !muted;

    setMutedState(nextMuted);
    applyAudioSettings(volume, nextMuted);
  }, [applyAudioSettings, muted, volume]);

  const enterFullscreen = useCallback<
    StreamPlayerControls['enterFullscreen']
  >(() => {
    const container = containerElementRef.current;
    if (!container) return;
    if (document.fullscreenElement) return;

    void container.requestFullscreen();
  }, []);

  const exitFullscreen = useCallback<
    StreamPlayerControls['exitFullscreen']
  >(() => {
    if (!document.fullscreenElement) return;
    void document.exitFullscreen();
  }, []);

  const toggleFullscreen = useCallback<
    StreamPlayerControls['toggleFullscreen']
  >(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }

    void containerElementRef.current?.requestFullscreen();
  }, []);

  const enterPiP = useCallback<StreamPlayerControls['enterPiP']>(
    async () => {
      const video = videoElementRef.current;
      if (!video) return;
      if (!document.pictureInPictureEnabled) return;
      if (document.pictureInPictureElement) return;

      try {
        await video.requestPictureInPicture();
      } catch {
        // ignore
      }
    },
    [],
  );

  const exitPiP = useCallback<StreamPlayerControls['exitPiP']>(async () => {
    if (!document.pictureInPictureElement) return;

    try {
      await document.exitPictureInPicture();
    } catch {
      // ignore
    }
  }, []);

  const togglePiP = useCallback<StreamPlayerControls['togglePiP']>(async () => {
    if (document.pictureInPictureElement) {
      await exitPiP();
      return;
    }

    await enterPiP();
  }, [enterPiP, exitPiP]);

  const sync = useCallback<StreamPlayerControls['sync']>(() => {
    socketRef.current?.emit('sync');
  }, []);

  useEffect(() => {
    if (!videoElement) return;

    const updateMetadata = () => {
      const nextDuration = Number.isFinite(videoElement.duration)
        ? videoElement.duration
        : 0;

      durationRef.current = nextDuration;
      setDuration(nextDuration);
    };

    const updateTime = () => {
      setCurrentTime(videoElement.currentTime);
    };

    const updatePlaying = () => {
      setIsPlaying(!videoElement.paused);
    };

    const handleEnded = () => {
      pause({ broadcast: true });
    };

    const updateVolume = () => {
      if (isWebAudioActiveRef.current) return;
      setVolumeState(videoElement.volume);
      setMutedState(videoElement.muted);
    };

    const handleEnterPiP = () => setIsPiP(true);
    const handleLeavePiP = () => setIsPiP(false);

    updateMetadata();
    updateTime();
    updatePlaying();
    updateVolume();

    const video = videoElementRef.current;
    if (!video) return;

    if (isWebAudioActiveRef.current) {
      video.volume = 1;
      video.muted = muted;

      const gain = audioGainRef.current;
      if (gain) gain.gain.value = muted ? 0 : volume;
    } else {
      video.muted = muted;
      video.volume = volume;
    }

    videoElement.addEventListener('loadedmetadata', updateMetadata);
    videoElement.addEventListener('durationchange', updateMetadata);
    videoElement.addEventListener('timeupdate', updateTime);
    videoElement.addEventListener('play', updatePlaying);
    videoElement.addEventListener('pause', updatePlaying);
    videoElement.addEventListener('ended', updatePlaying);
    videoElement.addEventListener('ended', handleEnded);
    videoElement.addEventListener('volumechange', updateVolume);
    videoElement.addEventListener('enterpictureinpicture', handleEnterPiP);
    videoElement.addEventListener('leavepictureinpicture', handleLeavePiP);

    return () => {
      videoElement.removeEventListener('loadedmetadata', updateMetadata);
      videoElement.removeEventListener('durationchange', updateMetadata);
      videoElement.removeEventListener('timeupdate', updateTime);
      videoElement.removeEventListener('play', updatePlaying);
      videoElement.removeEventListener('pause', updatePlaying);
      videoElement.removeEventListener('ended', updatePlaying);
      videoElement.removeEventListener('ended', handleEnded);
      videoElement.removeEventListener('volumechange', updateVolume);
      videoElement.removeEventListener('enterpictureinpicture', handleEnterPiP);
      videoElement.removeEventListener('leavepictureinpicture', handleLeavePiP);
    };
  }, [muted, pause, videoElement, volume]);

  useEffect(() => {
    return () => {
      try {
        audioSourceRef.current?.disconnect();
      } catch {
        // ignore
      }

      try {
        audioGainRef.current?.disconnect();
      } catch {
        // ignore
      }

      const context = audioContextRef.current;
      if (context) void context.close().catch(() => undefined);

      audioSourceRef.current = null;
      audioGainRef.current = null;
      audioContextRef.current = null;
      isWebAudioActiveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const socket = io(normalizedBackendUrl, { autoConnect: true });
    socketRef.current = socket;

    const handleConnect = () => {
      setIsSocketConnected(true);
      socket.emit('sync');
    };

    const handleDisconnect = () => setIsSocketConnected(false);

    const handleSyncState = (state: unknown) => {
      if (
        !state ||
        typeof state !== 'object' ||
        !('isPlaying' in state) ||
        !('currentTime' in state)
      ) {
        return;
      }

      const { isPlaying: playing, currentTime: time } = state as SyncState;
      if (typeof playing !== 'boolean') return;
      if (!isFiniteNumber(time)) return;

      const serverTimeMs = (state as SyncState).serverTimeMs;
      lastSyncStateRef.current = {
        isPlaying: playing,
        currentTime: time,
        serverTimeMs,
        receivedAtMs: Date.now(),
      };

      const video = videoElementRef.current;
      if (!video) return;
      if (isScrubbingRef.current) return;

      const targetTime =
        playing && isFiniteNumber(serverTimeMs)
          ? time + Math.max(0, (Date.now() - serverTimeMs) / 1000)
          : time;

      if (!video.seeking) {
        const driftSeconds = targetTime - video.currentTime;
        if (Math.abs(driftSeconds) > FORCE_SYNC_THRESHOLD_SECONDS) {
          seekTo(targetTime, { broadcast: false });
        }
      }

      if (playing && video.paused) void play({ broadcast: false });
      if (!playing && !video.paused) pause({ broadcast: false });
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('syncState', handleSyncState);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('syncState', handleSyncState);
      socket.disconnect();

      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [normalizedBackendUrl, pause, play, seekTo]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      const socket = socketRef.current;
      const video = videoElementRef.current;
      if (!socket || !video || !socket.connected) return;
      if (isScrubbingRef.current) return;

      const lastState = lastSyncStateRef.current;
      if (!lastState) {
        socket.emit('sync');
        return;
      }

      const nowMs = Date.now();
      if (nowMs - lastState.receivedAtMs > PLAYER_SYNC_CHECK_INTERVAL_MS * 2) {
        socket.emit('sync');
        return;
      }

      const serverTimeMs = lastState.serverTimeMs;
      const targetTime =
        lastState.isPlaying && isFiniteNumber(serverTimeMs)
          ? lastState.currentTime + Math.max(0, (nowMs - serverTimeMs) / 1000)
          : lastState.currentTime;

      if (!video.seeking) {
        const driftSeconds = targetTime - video.currentTime;
        if (Math.abs(driftSeconds) > FORCE_SYNC_THRESHOLD_SECONDS) {
          seekTo(targetTime, { broadcast: false });
        }
      }

      if (lastState.isPlaying && video.paused) void play({ broadcast: false });
      if (!lastState.isPlaying && !video.paused) pause({ broadcast: false });
    }, PLAYER_SYNC_CHECK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [pause, play, seekTo]);

  const state = useMemo<StreamPlayerState>(
    () => ({
      isSocketConnected,
      isPlaying,
      currentTime,
      duration,
      volume,
      muted,
      isFullscreen,
      isPiP,
    }),
    [
      currentTime,
      duration,
      isFullscreen,
      isPiP,
      isPlaying,
      isSocketConnected,
      muted,
      volume,
    ],
  );

  const controls = useMemo<StreamPlayerControls>(
    () => ({
      play,
      pause,
      togglePlay,
      seekTo,
      seekBy,
      setVolume,
      setMuted,
      toggleMute,
      enterFullscreen,
      exitFullscreen,
      toggleFullscreen,
      enterPiP,
      exitPiP,
      togglePiP,
      sync,
    }),
    [
      enterFullscreen,
      enterPiP,
      exitFullscreen,
      exitPiP,
      pause,
      play,
      seekBy,
      seekTo,
      setMuted,
      setVolume,
      sync,
      toggleFullscreen,
      toggleMute,
      togglePiP,
      togglePlay,
    ],
  );

  return {
    videoSrc,
    videoRef,
    containerRef,
    state,
    controls,
  };
}
