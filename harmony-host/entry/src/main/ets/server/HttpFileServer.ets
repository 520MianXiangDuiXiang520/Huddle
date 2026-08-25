import { socket } from '@kit.NetworkKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { cryptoFramework } from '@kit.CryptoArchitectureKit';

const HTTP_PORT: number = 8765;
const WS_GUID: string = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** A bridged WebSocket connection handed to HostRuntime. */
export interface WsConn {
  send: (text: string) => Promise<void>;
  /** Close the socket. Pass replaced=true when another connection took this seat. */
  close: (replaced?: boolean) => Promise<void>;
  remoteHost: string;
}

export interface HttpJsonResponse {
  status: number;
  json: string;
}

interface RequestInfo {
  method: string;
  path: string;
  headers: Record<string, string>;
  leftover: Uint8Array;
}

interface ConnState {
  buf: Uint8Array;
  textAcc: string;
  closed: boolean;
  wsMode: boolean;
  waiter: ((n: number) => void) | null;
  /** Peer address from SocketMessageInfo.remoteInfo (server-side getRemoteAddress is unreliable). */
  remoteHost: string;
}

interface WsEntry {
  client: socket.TCPSocketConnection;
  state: ConnState;
}

/**
 * Unified HTTP/1.1 + WebSocket server on a single port. Serves materialized
 * www assets to guests, and upgrades GET /ws to a WebSocket that bridges into
 * the authoritative Room. This mirrors the Android HostServer (HTTP + WS on the
 * same port/path) so the shared www client connects to ws://<host>:8765/ws.
 */
export class HttpFileServer {
  private tcpServer: socket.TCPSocketServer | null = null;
  private wwwRoot: string;
  private connSeq: number = 0;
  private wsConns: Map<string, WsEntry> = new Map<string, WsEntry>();
  onWsConnect: ((connId: string, conn: WsConn, deviceId: string) => void) | null = null;
  onWsMessage: ((connId: string, text: string) => void) | null = null;
  onWsClose: ((connId: string) => void) | null = null;
  onSyncRequest: ((deviceId: string) => HttpJsonResponse | null) | null = null;

  constructor(wwwRoot: string) {
    this.wwwRoot = wwwRoot;
  }

  async start(): Promise<void> {
    if (this.tcpServer) return;
    const srv: socket.TCPSocketServer = socket.constructTCPSocketServerInstance();
    const addr: socket.NetAddress = { address: '0.0.0.0', port: HTTP_PORT, family: 1 };
    await srv.listen(addr);
    this.tcpServer = srv;
    srv.on('connect', (client: socket.TCPSocketConnection) => {
      this.handle(client).catch(() => { try { client.close(); } catch (e) {} });
    });
  }

  async stop(): Promise<void> {
    if (this.tcpServer) {
      try { await this.tcpServer.close(); } catch (e) {}
      this.tcpServer = null;
    }
    this.wsConns.forEach((v) => { try { v.client.close(); } catch (e) {} });
    this.wsConns.clear();
  }

  private async handle(client: socket.TCPSocketConnection): Promise<void> {
    // Register ONE message/close listener for the whole connection lifetime.
    // Re-registering on('message') later (as the old recvOnce did) is unreliable
    // on HarmonyOS TCPSocketConnection and caused frames to stop being delivered
    // after the initial greet, producing the "响应较慢 / 不刷新" symptom.
    const connId: string = `c${++this.connSeq}`;
    const state: ConnState = {
      buf: new Uint8Array(0), textAcc: '', closed: false, wsMode: false, waiter: null, remoteHost: ''
    };
    client.on('message', (info: socket.SocketMessageInfo) => {
      // TCPSocketConnection.getRemoteAddress() often returns empty on the server
      // side (API is documented around client connect()). Peer IP on the first
      // HTTP/WS packet is what we use for one-seat-per-LAN-IP reclaim.
      if (state.remoteHost.length === 0 && info.remoteInfo && info.remoteInfo.address) {
        state.remoteHost = String(info.remoteInfo.address);
      }
      state.buf = concatUint8([state.buf, new Uint8Array(info.message)]);
      if (state.waiter) { const w = state.waiter; state.waiter = null; w(state.buf.length); }
      if (state.wsMode) this.consumeFrames(connId, state);
    });
    client.on('close', () => {
      state.closed = true;
      if (state.waiter) { const w = state.waiter; state.waiter = null; w(-1); }
      if (this.wsConns.has(connId)) {
        this.wsConns.delete(connId);
        if (this.onWsClose) this.onWsClose(connId);
      }
    });

    const req: RequestInfo | null = await this.readHeaders(client, state);
    if (req == null) { try { await client.close(); } catch (e) {} return; }
    const pathNoQuery: string = req.path.split('?')[0];
    const isWs: boolean = req.method === 'GET' && pathNoQuery === '/ws' && req.headers['upgrade'] === 'websocket';
    if (isWs) {
      const deviceId: string = parseQueryD(req.path);
      await this.upgradeWs(client, req.headers, state, connId, deviceId);
      return;
    }
    if (req.method === 'GET' && pathNoQuery === '/sync') {
      const result: HttpJsonResponse | null = this.onSyncRequest
        ? this.onSyncRequest(parseQueryD(req.path))
        : null;
      if (result) {
        await this.respond(client, result.status, 'application/json; charset=utf-8', strToBytes(result.json));
      } else {
        await this.respond(client, 404, 'application/json; charset=utf-8', strToBytes('{"error":"unknown client"}'));
      }
      return;
    }
    if (req.method !== 'GET') {
      await this.respond(client, 405, 'text/plain', strToBytes('Method Not Allowed'));
      return;
    }
    await this.servePath(client, req.path);
  }

  /** Wait until the buffer contains the CRLFCRLF header terminator, then parse. */
  private async readHeaders(client: socket.TCPSocketConnection, state: ConnState): Promise<RequestInfo | null> {
    const sep: Uint8Array = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);
    let guard: number = 0;
    while (guard < 16384) {
      const sepIdx: number = indexOfSub(state.buf, sep);
      if (sepIdx >= 0) {
        const headerBytes: Uint8Array = state.buf.subarray(0, sepIdx);
        // leftover remains in state.buf for upgradeWs / consumeFrames.
        state.buf = state.buf.subarray(sepIdx + 4);
        const dec: util.TextDecoder = new util.TextDecoder('utf-8');
        const headerText: string = dec.decode(headerBytes);
        const lines: string[] = headerText.split('\r\n');
        const reqLine: string = lines.length > 0 ? lines[0] : '';
        const parts: string[] = reqLine.split(' ');
        const method: string = parts.length > 0 ? parts[0] : 'GET';
        const path: string = parts.length > 1 ? parts[1] : '/';
        const headers: Record<string, string> = {};
        for (let i = 1; i < lines.length; i++) {
          const ln: string = lines[i];
          const ci: number = ln.indexOf(':');
          if (ci > 0) {
            const k: string = ln.substring(0, ci).trim().toLowerCase();
            const v: string = ln.substring(ci + 1).trim();
            headers[k] = v;
          }
        }
        return { method, path, headers, leftover: state.buf };
      }
      if (state.closed) return null;
      const before: number = state.buf.length;
      const got: boolean = await this.waitForData(state);
      if (state.closed) return null;
      if (!got && state.buf.length === before) return null; // timed out with no data
      guard += Math.max(0, state.buf.length - before) + 1;
    }
    return null;
  }

  private waitForData(state: ConnState): Promise<boolean> {
    return new Promise<boolean>((resolve: (v: boolean) => void) => {
      let done: boolean = false;
      state.waiter = (() => { if (!done) { done = true; resolve(true); } }) as (n: number) => void;
      setTimeout(() => {
        if (!done) { done = true; resolve(false); }
      }, 8000);
    });
  }

  /** Perform the WebSocket handshake and bridge the TCP connection into the room. */
  private async upgradeWs(client: socket.TCPSocketConnection, headers: Record<string, string>, state: ConnState, connId: string, deviceId: string): Promise<void> {
    const key: string = headers['sec-websocket-key'] ?? '';
    if (key.length === 0) { try { await client.close(); } catch (e) {} return; }
    const accept: string = await wsAccept(key);
    const resp: string = 'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n';
    try {
      await client.send({ data: toExactBuffer(strToBytes(resp)) });
    } catch (e) {
      try { await client.close(); } catch (e2) {}
      return;
    }
    // Prefer address learned from the handshake packet; fall back to API.
    let remoteHost: string = state.remoteHost;
    if (remoteHost.length === 0) {
      try {
        const peer: socket.NetAddress = await client.getRemoteAddress();
        remoteHost = peer.address ?? '';
      } catch (e) {}
    }
    if (remoteHost.length > 0) state.remoteHost = remoteHost;
    state.wsMode = true;
    this.wsConns.set(connId, { client, state });

    // Serialize outbound sends. HarmonyOS TCPSocketConnection.send does not
    // reliably handle overlapping (non-awaited) sends on the same connection —
    // the 2nd call can be dropped/rejected, which silently lost actionAck and
    // ntf_game (greet/heartbeats worked because they didn't overlap). Chaining
    // each send onto the previous promise guarantees ordered, non-overlapping
    // delivery.
    let sendChain: Promise<void> = Promise.resolve();
    const conn: WsConn = {
      remoteHost: state.remoteHost,
      send: (text: string): Promise<void> => {
        // Keep the chain alive after an error, but return the actual operation
        // so HostRuntime can remove a dead session instead of silently treating
        // a failed write as successful.
        // Slice to an exact ArrayBuffer — sending u8.buffer can include trailing
        // bytes when the view is backed by a larger buffer, which desyncs the
        // browser's WebSocket frame parser.
        const current: Promise<void> = sendChain
          .then(() => client.send({ data: toExactBuffer(encodeTextFrame(text)) }));
        sendChain = current.catch(() => {});
        return current;
      },
      close: async (replaced?: boolean) => {
        try {
          await client.send({
            data: toExactBuffer(encodeCloseFrame(replaced ? 4000 : 1000, replaced ? 'replaced' : ''))
          });
        } catch (e) {}
        try { await client.close(); } catch (e) {}
      }
    };
    if (this.onWsConnect) this.onWsConnect(connId, conn, deviceId);

    // Process any leftover bytes already received before wsMode was set.
    this.consumeFrames(connId, state);
  }

  /** Parse as many complete frames as available for a connection. */
  private consumeFrames(connId: string, state: ConnState): void {
    if (state.closed) return;
    const buf: Uint8Array = state.buf;
    let offset: number = 0;
    while (offset < buf.length) {
      const r: FrameResult | null = parseFrame(buf, offset, state);
      if (r == null) break;
      offset = r.next;
      if (r.kind === 'text' && this.onWsMessage) this.onWsMessage(connId, r.text ?? '');
      if (r.kind === 'close') {
        const entry: WsEntry | undefined = this.wsConns.get(connId);
        state.closed = true;
        this.wsConns.delete(connId);
        if (entry) { try { entry.client.close(); } catch (e) {} }
        if (this.onWsClose) this.onWsClose(connId);
        return;
      }
    }
    state.buf = buf.subarray(offset);
  }

  private async servePath(client: socket.TCPSocketConnection, rawPath: string): Promise<void> {
    let rel: string = decodeURIComponent(rawPath.split('?')[0]).replace(/^\/+/, '');
    if (rel === '' || rel === 'index.html') rel = 'index.html';
    if (rel.includes('..')) { await this.respond(client, 400, 'text/plain', strToBytes('Bad Request')); return; }
    const filePath: string = `${this.wwwRoot}/${rel}`;
    let exists: boolean = false;
    try { exists = await fileIo.access(filePath); } catch (e) { exists = false; }
    if (!exists) { await this.respond(client, 404, 'text/plain', strToBytes('Not Found')); return; }
    try {
      const data: Uint8Array = readFileSync(filePath);
      const mime: string = mimeFor(rel);
      await this.respond(client, 200, mime, data);
    } catch (e) {
      await this.respond(client, 404, 'text/plain', strToBytes('Not Found'));
    }
  }

  private async respond(client: socket.TCPSocketConnection, status: number, mime: string, bodyBytes: Uint8Array): Promise<void> {
    const statusText: string = status === 200 ? 'OK' : status === 404 ? 'Not Found' : status === 400 ? 'Bad Request' : 'Error';
    const head: string = `HTTP/1.1 ${status} ${statusText}\r\nContent-Type: ${mime}\r\nContent-Length: ${bodyBytes.byteLength}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n`;
    const headBytes: Uint8Array = strToBytes(head);
    const out: Uint8Array = new Uint8Array(headBytes.byteLength + bodyBytes.byteLength);
    out.set(headBytes, 0);
    out.set(bodyBytes, headBytes.byteLength);
    try {
      const opts: socket.TCPSendOptions = { data: toExactBuffer(out) };
      await client.send(opts);
    } catch (e) {}
    try { await client.close(); } catch (e) {}
  }
}

/** Exact ArrayBuffer for TCPSocketConnection.send (no trailing pooled bytes). */
function toExactBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

export function mimeFor(path: string): string {
  const parts: string[] = path.split('.');
  const ext: string = (parts.length > 0 ? parts[parts.length - 1] : '').toLowerCase();
  switch (ext) {
    case 'html': case 'htm': return 'text/html; charset=utf-8';
    case 'css': return 'text/css; charset=utf-8';
    case 'js': return 'application/javascript; charset=utf-8';
    case 'json': return 'application/json; charset=utf-8';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'svg': return 'image/svg+xml';
    case 'ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

interface FrameResult {
  kind: string; // 'text' | 'close' | 'ping' | 'pong'
  text: string | null;
  next: number;
}

/** Parse one WebSocket frame starting at offset. Client->server frames are masked. */
function parseFrame(buf: Uint8Array, offset: number, state: ConnState): FrameResult | null {
  if (buf.length - offset < 2) return null;
  const b0: number = buf[offset];
  const b1: number = buf[offset + 1];
  const fin: boolean = (b0 & 0x80) !== 0;
  const opcode: number = b0 & 0x0f;
  const masked: boolean = (b1 & 0x80) !== 0;
  let len: number = b1 & 0x7f;
  let p: number = offset + 2;
  if (len === 126) {
    if (buf.length - p < 2) return null;
    len = (buf[p] << 8) | buf[p + 1];
    p += 2;
  } else if (len === 127) {
    if (buf.length - p < 8) return null;
    len = 0;
    for (let i = 0; i < 8; i++) len = len * 256 + buf[p + i];
    p += 8;
  }
  let maskKey: Uint8Array = new Uint8Array(0);
  if (masked) {
    if (buf.length - p < 4) return null;
    maskKey = buf.subarray(p, p + 4);
    p += 4;
  }
  if (buf.length - p < len) return null;
  let payload: Uint8Array = buf.subarray(p, p + len);
  if (masked) {
    const unmasked: Uint8Array = new Uint8Array(len);
    for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
    payload = unmasked;
  }
  const next: number = p + len;
  if (opcode === 0x8) return { kind: 'close', text: null, next };
  if (opcode === 0x9) return { kind: 'ping', text: null, next };
  if (opcode === 0xa) return { kind: 'pong', text: null, next };
  // text (1) or continuation (0)
  const dec: util.TextDecoder = new util.TextDecoder('utf-8');
  state.textAcc += dec.decode(payload);
  if (!fin) return { kind: 'pong', text: null, next }; // fragment; wait for fin
  const text: string = state.textAcc;
  state.textAcc = '';
  return { kind: 'text', text, next };
}

/** Encode a text message as a single unmasked server frame. */
function encodeTextFrame(text: string): Uint8Array {
  const enc: util.TextEncoder = new util.TextEncoder();
  const payload: Uint8Array = enc.encode(text);
  const len: number = payload.length;
  let header: Uint8Array;
  if (len < 126) {
    header = new Uint8Array(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = new Uint8Array(4);
    header[0] = 0x81;
    header[1] = 126;
    header[2] = (len >> 8) & 0xff;
    header[3] = len & 0xff;
  } else {
    header = new Uint8Array(10);
    header[0] = 0x81;
    header[1] = 127;
    let v: number = len;
    for (let i = 9; i >= 2; i--) { header[i] = v & 0xff; v = Math.floor(v / 256); }
  }
  const out: Uint8Array = new Uint8Array(header.length + len);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

/** Server close frame; optional code (e.g. 4000 = superseded) + UTF-8 reason. */
function encodeCloseFrame(code: number = 1000, reason: string = ''): Uint8Array {
  const enc: util.TextEncoder = new util.TextEncoder();
  const reasonBytes: Uint8Array = reason.length > 0 ? enc.encode(reason) : new Uint8Array(0);
  const payloadLen: number = 2 + reasonBytes.length;
  const out: Uint8Array = new Uint8Array(2 + payloadLen);
  out[0] = 0x88;
  out[1] = payloadLen;
  out[2] = (code >> 8) & 0xff;
  out[3] = code & 0xff;
  if (reasonBytes.length > 0) out.set(reasonBytes, 4);
  return out;
}

async function wsAccept(key: string): Promise<string> {
  const enc: util.TextEncoder = new util.TextEncoder();
  const md: cryptoFramework.Md = cryptoFramework.createMd('SHA1');
  await md.update({ data: enc.encode(key + WS_GUID) });
  const out: cryptoFramework.DataBlob = await md.digest();
  return new util.Base64Helper().encodeToStringSync(out.data);
}

function strToBytes(s: string): Uint8Array {
  const encoder: util.TextEncoder = new util.TextEncoder();
  return encoder.encode(s);
}

function readFileSync(path: string): Uint8Array {
  const file = fileIo.openSync(path, fileIo.OpenMode.READ_ONLY);
  const size: number = fileIo.statSync(path).size;
  const buf: ArrayBuffer = new ArrayBuffer(size);
  fileIo.readSync(file.fd, buf);
  fileIo.closeSync(file);
  return new Uint8Array(buf);
}

function concatUint8(arrays: Uint8Array[]): Uint8Array {
  let total: number = 0;
  for (const a of arrays) total += a.length;
  const out: Uint8Array = new Uint8Array(total);
  let p: number = 0;
  for (const a of arrays) { out.set(a, p); p += a.length; }
  return out;
}

function indexOfSub(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0) return 0;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let ok: boolean = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

/** Extract the `d` query parameter from a request path (e.g. "/ws?d=abc"). */
function parseQueryD(rawPath: string): string {
  const qIdx: number = rawPath.indexOf('?');
  if (qIdx < 0) return '';
  const q: string = rawPath.substring(qIdx + 1);
  const pairs: string[] = q.split('&');
  for (const kv of pairs) {
    const eq: number = kv.indexOf('=');
    if (eq > 0 && kv.substring(0, eq) === 'd') {
      try { return decodeURIComponent(kv.substring(eq + 1)); } catch (e) { return kv.substring(eq + 1); }
    }
  }
  return '';
}
