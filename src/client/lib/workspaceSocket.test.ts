import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSocket } from "./workspaceSocket";

/** Minimal fake WebSocket that records instances and lets tests drive its lifecycle. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  send(): void {}
  triggerOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  triggerClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("WorkspaceSocket — unauthorized vs. genuine network failure", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
    (globalThis as unknown as { location: unknown }).location = { protocol: "http:", host: "localhost:5173" };
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeSocket(onStatusChange = vi.fn()) {
    const socket = new WorkspaceSocket({
      workspaceId: "demo",
      userId: "u-x",
      displayName: "X",
      onMessage: vi.fn(),
      onStatusChange,
    });
    return { socket, onStatusChange };
  }

  it("stops permanently on a 403 preflight — no WebSocket is ever opened, no reconnect scheduled", async () => {
    fetchMock.mockResolvedValue({ status: 403 });
    const { socket, onStatusChange } = makeSocket();

    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(onStatusChange).toHaveBeenCalledWith("unauthorized");
    expect(FakeWebSocket.instances.length).toBe(0);

    // Advance well past any backoff window — must NOT retry.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances.length).toBe(0);
  });

  it("opens the socket normally when the preflight succeeds", async () => {
    fetchMock.mockResolvedValue({ status: 200 });
    const { socket, onStatusChange } = makeSocket();

    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(FakeWebSocket.instances.length).toBe(1);
    FakeWebSocket.instances[0].triggerOpen();
    expect(onStatusChange).toHaveBeenCalledWith("open");
  });

  it("still retries with backoff on a genuine post-connect network drop (not unauthorized)", async () => {
    fetchMock.mockResolvedValue({ status: 200 });
    const { socket, onStatusChange } = makeSocket();

    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeWebSocket.instances.length).toBe(1);
    FakeWebSocket.instances[0].triggerOpen();

    // Network drop.
    FakeWebSocket.instances[0].triggerClose();
    expect(onStatusChange).toHaveBeenCalledWith("closed");
    expect(onStatusChange).not.toHaveBeenCalledWith("unauthorized");

    // Backoff fires -> preflight re-runs -> a NEW socket is attempted.
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it("does not treat a failed preflight fetch (offline) as unauthorized — falls through to a normal WS attempt", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const { socket, onStatusChange } = makeSocket();

    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(onStatusChange).not.toHaveBeenCalledWith("unauthorized");
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it("close() from the caller stops reconnect attempts entirely", async () => {
    fetchMock.mockResolvedValue({ status: 200 });
    const { socket } = makeSocket();

    socket.connect();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    FakeWebSocket.instances[0].triggerOpen();

    socket.close();
    FakeWebSocket.instances[0].triggerClose();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances.length).toBe(1); // no further attempts
  });
});
