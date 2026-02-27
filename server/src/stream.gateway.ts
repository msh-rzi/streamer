// stream.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';
import type { OnModuleDestroy } from '@nestjs/common';
import { Server, type Socket } from 'socket.io';

type SyncState = {
  isPlaying: boolean;
  currentTime: number;
  serverTimeMs: number;
};

type StreamState = {
  isPlaying: boolean;
  currentTime: number;
  updatedAtMs: number;
};

const SYNC_BROADCAST_INTERVAL_MS = 2000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

@WebSocketGateway({
  cors: true,
})
export class StreamGateway implements OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private state: StreamState = {
    isPlaying: false,
    currentTime: 0,
    updatedAtMs: Date.now(),
  };

  private broadcastIntervalId: ReturnType<typeof setInterval> | null = null;

  afterInit() {
    this.broadcastIntervalId = setInterval(() => {
      this.broadcastSyncState();
    }, SYNC_BROADCAST_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.broadcastIntervalId) clearInterval(this.broadcastIntervalId);
    this.broadcastIntervalId = null;
  }

  private getEffectiveTime(nowMs: number) {
    const baseTime = isFiniteNumber(this.state.currentTime)
      ? this.state.currentTime
      : 0;

    if (!this.state.isPlaying) return Math.max(0, baseTime);

    const elapsedSeconds = Math.max(0, (nowMs - this.state.updatedAtMs) / 1000);
    return Math.max(0, baseTime + elapsedSeconds);
  }

  private commitTime(nowMs: number) {
    this.state.currentTime = this.getEffectiveTime(nowMs);
    this.state.updatedAtMs = nowMs;
  }

  private getSyncState(nowMs: number): SyncState {
    return {
      isPlaying: this.state.isPlaying,
      currentTime: this.getEffectiveTime(nowMs),
      serverTimeMs: nowMs,
    };
  }

  private broadcastSyncState() {
    if (!this.server) return;
    const nowMs = Date.now();
    this.server.emit('syncState', this.getSyncState(nowMs));
  }

  @SubscribeMessage('play')
  handlePlay(@MessageBody() time: unknown) {
    console.log('Play event received');

    const nowMs = Date.now();

    if (isFiniteNumber(time)) {
      this.state.currentTime = Math.max(0, time);
      this.state.updatedAtMs = nowMs;
    } else {
      this.commitTime(nowMs);
    }

    this.state.isPlaying = true;
    this.state.updatedAtMs = nowMs;
    this.broadcastSyncState();
  }

  @SubscribeMessage('pause')
  handlePause(@MessageBody() time: unknown) {
    console.log('Pause event received');

    const nowMs = Date.now();

    if (isFiniteNumber(time)) {
      this.state.currentTime = Math.max(0, time);
      this.state.updatedAtMs = nowMs;
    } else {
      this.commitTime(nowMs);
    }

    this.state.isPlaying = false;
    this.state.updatedAtMs = nowMs;
    this.broadcastSyncState();
  }

  @SubscribeMessage('seek')
  handleSeek(@MessageBody() time: unknown) {
    if (!isFiniteNumber(time)) return;

    const nowMs = Date.now();
    this.state.currentTime = Math.max(0, time);
    this.state.updatedAtMs = nowMs;
    this.broadcastSyncState();
  }

  @SubscribeMessage('sync')
  handleSync(client: Socket) {
    client.emit('syncState', this.getSyncState(Date.now()));
  }
}
