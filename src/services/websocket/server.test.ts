import { EventEmitter } from "events";
import type { Server } from "http";

jest.mock("../../config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockAuthenticate = jest.fn();
jest.mock("./wsAuth", () => ({
  authenticateWsUpgrade: (...args: unknown[]) => mockAuthenticate(...args),
}));

jest.mock("ws", () => {
  const { EventEmitter: Emitter } = require("events");

  class FakeSocket extends Emitter {
    readyState = 1;
    userId: string | null = null;
    isAlive = true;
    ping = jest.fn();
    terminate = jest.fn();
    send = jest.fn();
  }

  class FakeWebSocketServer extends Emitter {
    static instances: FakeWebSocketServer[] = [];
    clients = new Set<FakeSocket>();
    handleUpgrade = jest.fn(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: FakeSocket) => void,
      ) => {
        const ws = new FakeSocket();
        this.clients.add(ws);
        cb(ws);
      },
    );
    close = jest.fn();

    constructor() {
      super();
      FakeWebSocketServer.instances.push(this);
    }
  }

  return {
    WebSocketServer: FakeWebSocketServer,
    WebSocket: { OPEN: 1, CLOSED: 3 },
  };
});

import { WebSocketServer } from "ws";
import { createBalanceWebSocketServer } from "./server";

interface FakeSocketLike extends EventEmitter {
  readyState: number;
  userId: string | null;
  isAlive: boolean;
  ping: jest.Mock;
  terminate: jest.Mock;
  send: jest.Mock;
}

interface FakeWssLike extends EventEmitter {
  clients: Set<FakeSocketLike>;
  handleUpgrade: jest.Mock;
  close: jest.Mock;
}

const AUTH_RESULT = {
  keyId: "key-1",
  userId: "user-1",
  organizationId: null,
  keyType: "USER_KEY",
  permissions: [],
};

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe("createBalanceWebSocketServer", () => {
  let httpServer: EventEmitter;
  let wss: FakeWssLike;
  let server: ReturnType<typeof createBalanceWebSocketServer>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockAuthenticate.mockResolvedValue(AUTH_RESULT);
    const instances = (
      WebSocketServer as unknown as { instances: FakeWssLike[] }
    ).instances;
    instances.length = 0;
    httpServer = new EventEmitter();
    server = createBalanceWebSocketServer(httpServer as unknown as Server, {
      heartbeatIntervalMs: 30_000,
    });
    wss = instances[instances.length - 1];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function upgrade(url = "/ws/balances"): {
    write: jest.Mock;
    destroy: jest.Mock;
  } {
    const socket = { write: jest.fn(), destroy: jest.fn() };
    httpServer.emit("upgrade", { url }, socket, Buffer.alloc(0));
    return socket;
  }

  it("authenticates the upgrade and tags the socket with the user", async () => {
    upgrade();
    await flush();

    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(wss.handleUpgrade).toHaveBeenCalledTimes(1);
    expect(wss.clients.size).toBe(1);
    const [socket] = [...wss.clients];
    expect(socket.userId).toBe("user-1");
    expect(socket.isAlive).toBe(true);
  });

  it("rejects the upgrade with 401 when auth fails", async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error("Invalid API key"));
    const socket = upgrade();
    await flush();

    expect(socket.write).toHaveBeenCalledWith(
      "HTTP/1.1 401 Unauthorized\r\n\r\n",
    );
    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(wss.handleUpgrade).not.toHaveBeenCalled();
    expect(wss.clients.size).toBe(0);
  });

  it("rejects upgrades to other paths with 404", async () => {
    const socket = upgrade("/other");
    await flush();

    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(socket.write).toHaveBeenCalledWith("HTTP/1.1 404 Not Found\r\n\r\n");
    expect(socket.destroy).toHaveBeenCalledTimes(1);
    expect(wss.handleUpgrade).not.toHaveBeenCalled();
  });

  it("pings alive sockets every 30 seconds", async () => {
    upgrade();
    await flush();
    const [socket] = [...wss.clients];

    jest.advanceTimersByTime(30_000);

    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it("terminates a socket that misses a pong", async () => {
    upgrade();
    await flush();
    const [socket] = [...wss.clients];

    jest.advanceTimersByTime(30_000);
    jest.advanceTimersByTime(30_000);

    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it("keeps a socket that answers pong", async () => {
    upgrade();
    await flush();
    const [socket] = [...wss.clients];

    jest.advanceTimersByTime(30_000);
    socket.emit("pong");
    jest.advanceTimersByTime(30_000);

    expect(socket.ping).toHaveBeenCalledTimes(2);
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it("broadcasts balance updates only to the matching user", async () => {
    upgrade();
    await flush();
    mockAuthenticate.mockResolvedValueOnce({
      ...AUTH_RESULT,
      userId: "user-2",
    });
    upgrade();
    await flush();
    upgrade();
    await flush();
    const [first, second, third] = [...wss.clients];
    third.readyState = 3;

    const sent = server.broadcastBalanceUpdate({
      userId: "user-1",
      currency: "ACBU",
      availableBalance: "100.50",
      updatedAt: "2026-11-20T21:00:00.000Z",
    });

    expect(sent).toBe(1);
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(first.send.mock.calls[0][0] as string)).toEqual({
      type: "balance.update",
      userId: "user-1",
      currency: "ACBU",
      availableBalance: "100.50",
      updatedAt: "2026-11-20T21:00:00.000Z",
    });
    expect(second.send).not.toHaveBeenCalled();
    expect(third.send).not.toHaveBeenCalled();
  });

  it("close() clears the heartbeat and terminates clients", async () => {
    upgrade();
    await flush();
    const [socket] = [...wss.clients];

    server.close();

    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(wss.close).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60_000);
    expect(socket.ping).not.toHaveBeenCalled();
  });
});
