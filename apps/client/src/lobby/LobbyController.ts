import { type RoomSummary, validateNickname } from '@booberman/protocol';
import { roomPath } from './joinTarget';
import { nicknameMessage } from './nicknameMessage';
import { loadNickname, type NicknameStorage, saveNickname } from './nicknameStore';
import { createRoom, listRooms } from './roomsApi';

export const ROOM_LIST_REFRESH_MS = 5000;

export const CREATE_ERROR_MESSAGE = 'สร้างห้องไม่สำเร็จ ลองใหม่อีกครั้ง';
export const ROOMS_ERROR_MESSAGE = 'โหลดรายการห้องไม่สำเร็จ';

export function rateLimitedMessage(seconds: number): string {
  return `สร้างห้องบ่อยเกินไป รออีก ${seconds} วินาทีแล้วลองใหม่`;
}

export interface LobbyState {
  nickname: string;
  /** Thai message for the current nickname, or null when fine / not shown yet. */
  nicknameError: string | null;
  /** null = first load still pending. */
  rooms: RoomSummary[] | null;
  roomsError: boolean;
  creating: boolean;
  /** Set once we are leaving for /room/:id; every action is locked. */
  navigating: boolean;
  createError: string | null;
  /** Seconds left before "create room" works again after a 429; 0 = free. */
  cooldownSeconds: number;
}

export interface LobbyTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface LobbyDeps {
  fetchFn?: typeof fetch;
  storage?: NicknameStorage;
  navigate: (path: string) => void;
  /**
   * Enter a room without leaving the page (the `/room/:id` screens, which already run inside the
   * game). When absent, entering navigates to `/room/<id>?nick=...` (the home page).
   */
  enter?: (roomId: string, nickname: string) => void;
  timers?: LobbyTimers;
}

const realTimers: LobbyTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

/**
 * Logic of the home screen with no DOM and no Phaser, so it can be unit-tested. The overlay renders
 * `state` and forwards clicks. Everything async is guarded against the screen having been torn down.
 */
export class LobbyController {
  private current: LobbyState;
  private readonly listeners = new Set<(s: LobbyState) => void>();
  private readonly fetchFn: typeof fetch | undefined;
  private readonly storage: NicknameStorage | undefined;
  private readonly navigate: (path: string) => void;
  private readonly enter: ((roomId: string, nickname: string) => void) | undefined;
  private readonly timers: LobbyTimers;
  private destroyed = false;
  private started = false;
  private abort = new AbortController();
  private refreshTimer: unknown;
  private cooldownTimer: unknown;
  /** Bumped per room-list request; a response that is not the latest one is dropped. */
  private refreshSeq = 0;
  private refreshing = false;

  constructor(deps: LobbyDeps) {
    this.fetchFn = deps.fetchFn;
    this.storage = deps.storage;
    this.navigate = deps.navigate;
    this.enter = deps.enter;
    this.timers = deps.timers ?? realTimers;
    this.current = {
      nickname: deps.storage === undefined ? loadNickname() : loadNickname(deps.storage),
      nicknameError: null,
      rooms: null,
      roomsError: false,
      creating: false,
      navigating: false,
      createError: null,
      cooldownSeconds: 0,
    };
  }

  get state(): LobbyState {
    return this.current;
  }

  subscribe(listener: (s: LobbyState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Loads the room list now and keeps it fresh until `destroy()`. */
  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    void this.refreshRooms();
    this.refreshTimer = this.timers.setInterval(
      () => void this.refreshRooms(),
      ROOM_LIST_REFRESH_MS,
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abort.abort();
    if (this.refreshTimer !== undefined) this.timers.clearInterval(this.refreshTimer);
    this.stopCooldown();
    this.listeners.clear();
  }

  /** Called on every keystroke. */
  setNickname(raw: string): void {
    const result = validateNickname(raw);
    if (result.ok) saveNickname(result.value, this.storage);
    this.patch({ nickname: raw, nicknameError: result.ok ? null : nicknameMessage(result.reason) });
  }

  async refreshRooms(): Promise<void> {
    if (this.destroyed || this.refreshing) return;
    this.refreshing = true;
    const seq = ++this.refreshSeq;
    try {
      const result = await listRooms(this.fetchFn, this.abort.signal);
      // screen gone, or a newer request already answered
      if (this.destroyed || seq !== this.refreshSeq) return;
      if (result.status === 'ok') this.patch({ rooms: result.rooms, roomsError: false });
      else this.patch({ roomsError: true });
    } finally {
      this.refreshing = false;
    }
  }

  async createRoom(): Promise<void> {
    if (!this.canAct() || this.current.cooldownSeconds > 0) return;
    const nickname = this.checkNickname();
    if (nickname === undefined) return;
    this.patch({ creating: true, createError: null });
    const result = await createRoom(this.fetchFn, this.abort.signal);
    if (this.destroyed) return;
    if (result.status === 'ok') {
      this.go(result.roomId, nickname);
    } else if (result.status === 'rate-limited') {
      this.patch({ creating: false });
      this.startCooldown(result.retryAfterSeconds);
    } else {
      this.patch({ creating: false, createError: CREATE_ERROR_MESSAGE });
    }
  }

  joinRoom(roomId: string): void {
    if (!this.canAct()) return;
    const nickname = this.checkNickname();
    if (nickname === undefined) return;
    this.go(roomId, nickname);
  }

  private canAct(): boolean {
    return !this.destroyed && !this.current.creating && !this.current.navigating;
  }

  /** Trimmed nickname if valid; otherwise shows the reason and returns undefined. */
  private checkNickname(): string | undefined {
    const result = validateNickname(this.current.nickname);
    if (result.ok) return result.value;
    this.patch({ nicknameError: nicknameMessage(result.reason) });
    return undefined;
  }

  private go(roomId: string, nickname: string): void {
    saveNickname(nickname, this.storage);
    this.patch({ creating: false, navigating: true, createError: null });
    if (this.enter) {
      this.enter(roomId, nickname);
      return;
    }
    // the nickname rides in the URL: localStorage may be blocked, so it cannot be the only carrier
    this.navigate(roomPath(roomId, nickname));
  }

  private startCooldown(seconds: number): void {
    this.stopCooldown();
    this.patch({ cooldownSeconds: seconds, createError: rateLimitedMessage(seconds) });
    this.cooldownTimer = this.timers.setInterval(() => {
      const left = this.current.cooldownSeconds - 1;
      if (left <= 0) {
        this.stopCooldown();
        this.patch({ cooldownSeconds: 0, createError: null });
      } else {
        this.patch({ cooldownSeconds: left, createError: rateLimitedMessage(left) });
      }
    }, 1000);
  }

  private stopCooldown(): void {
    if (this.cooldownTimer !== undefined) this.timers.clearInterval(this.cooldownTimer);
    this.cooldownTimer = undefined;
  }

  private patch(change: Partial<LobbyState>): void {
    if (this.destroyed) return;
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener(this.current);
  }
}
