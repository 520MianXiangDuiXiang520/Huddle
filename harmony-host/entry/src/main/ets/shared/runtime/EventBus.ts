import type { BusSink, OutboundMessage } from "./types";

export class EventBus {
  private sink: BusSink;
  constructor(sink: BusSink) {
    this.sink = sink;
  }
  broadcast(json: string): void {
    const m: OutboundMessage = { kind: "broadcast", json: json };
    this.sink(m);
  }
  toPlayer(playerId: string, json: string): void {
    const m: OutboundMessage = { kind: "toPlayer", playerId: playerId, json: json };
    this.sink(m);
  }
}
