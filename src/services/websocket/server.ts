/**
 * W11-AUD-013: WebSocket server for balance updates with heartbeat.
 *
 * No WebSocket server existed in this repo before this change, only the
 * upgrade-auth helper in ./wsAuth. This module builds the server the
 * issue describes: clients connect on /ws/balances, authenticate with
 * the same API-key rules as ./wsAuth, and receive balance updates pushed
 * with broadcastBalanceUpdate().
 *
 * Zombie sockets are reaped with a 30-second ping/pong heartbeat. A
 * socket that misses one pong is terminated on the next tick, so dead
 * connections stop holding file descriptors and memory.
 *
 * Producer wiring is deferred: no balance-change code calls
 * broadcastBalanceUpdate() yet. Producers should reach the running
 * instance through getBalanceWebSocketServer().
 */

import { type IncomingMessage, type Server as HttpServer } from "http";
import { type Socket } from "net";
import { WebSocket, WebSocketServer } from "ws";
import { logger } from "../../config/logger";
import { authenticateWsUpgrade, type WsAuthResult } from "./wsAuth";

/** How often the server pings clients, in milliseconds. */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/** Upgrade path clients connect to. */
export const WS_BALANCES_PATH = "/ws/balances";

export interface BalanceUpdatePayload {
  userId: string;
  currency: string;
  availableBalance: string;
  updatedAt: string;
}

type AliveSocket = WebSocket & {
  isAlive: boolean;
  userId: string | null;
};

export interface BalanceWebSocketServer {
  wss: WebSocketServer;
  broadcastBalanceUpdate(update: BalanceUpdatePayload): number;
  close(): void;
}

let activeServer: BalanceWebSocketServer | null = null;

/** The running balance WebSocket server, if one was created. */
export function getBalanceWebSocketServer(): BalanceWebSocketServer | null {
  return activeServer;
}

export function createBalanceWebSocketServer(
  httpServer: HttpServer,
  options: { heartbeatIntervalMs?: number } = {},
): BalanceWebSocketServer {
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? WS_HEARTBEAT_INTERVAL_MS;
  const wss = new WebSocketServer({ noServer: true });

  // Sockets that asked for an upgrade but are still awaiting
  // authentication. They are not in wss.clients yet, so close() must
  // destroy them explicitly or shutdown can wait on them forever.
  const pendingUpgrades = new Set<Socket>();

  // Reap sockets that stop answering pings. A socket that misses one
  // pong is terminated on the next tick.
  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
      const client = socket as AliveSocket;
      if (client.isAlive === false) {
        logger.warn("[ws] Terminating unresponsive client socket");
        client.terminate();
        return;
      }
      client.isAlive = false;
      client.ping();
    });
  }, heartbeatIntervalMs);

  httpServer.on("upgrade", (req, socket, head) => {
    pendingUpgrades.add(socket);
    void handleUpgrade(req, socket, head);
  });

  async function handleUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): Promise<void> {
    // Node removes its HTTP error listener before emitting upgrade, and
    // ws only installs one once handleUpgrade runs, so a reset while
    // authentication waits would otherwise crash the process.
    let upgradeFailed = false;
    const onSocketError = (): void => {
      upgradeFailed = true;
      socket.destroy();
    };
    socket.once("error", onSocketError);
    try {
      let pathname = "";
      try {
        pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      } catch {
        pathname = "";
      }
      if (pathname !== WS_BALANCES_PATH) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }

      let auth: WsAuthResult;
      try {
        auth = await authenticateWsUpgrade(req);
      } catch {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      socket.removeListener("error", onSocketError);
      if (upgradeFailed) {
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const client = ws as AliveSocket;
        client.userId = auth.userId;
        client.isAlive = true;
        wss.emit("connection", ws, req);
      });
    } finally {
      socket.removeListener("error", onSocketError);
      pendingUpgrades.delete(socket);
    }
  }

  wss.on("connection", (socket: WebSocket) => {
    const client = socket as AliveSocket;
    client.isAlive = true;
    client.on("pong", () => {
      client.isAlive = true;
    });
    client.on("close", () => {
      logger.info("[ws] Client disconnected", { userId: client.userId });
    });
    client.on("error", (error: Error) => {
      logger.warn("[ws] Client socket error", {
        userId: client.userId,
        message: error.message,
      });
    });
    logger.info("[ws] Client connected", { userId: client.userId });
  });

  function broadcastBalanceUpdate(update: BalanceUpdatePayload): number {
    const message = JSON.stringify({ type: "balance.update", ...update });
    let sent = 0;
    wss.clients.forEach((socket) => {
      const client = socket as AliveSocket;
      if (client.userId !== update.userId) {
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(message);
      sent += 1;
    });
    return sent;
  }

  function close(): void {
    clearInterval(heartbeat);
    pendingUpgrades.forEach((socket) => {
      socket.destroy();
    });
    pendingUpgrades.clear();
    wss.clients.forEach((socket) => {
      socket.terminate();
    });
    wss.close();
    if (activeServer === server) {
      activeServer = null;
    }
  }

  const server: BalanceWebSocketServer = { wss, broadcastBalanceUpdate, close };
  activeServer = server;
  return server;
}
