import type { BusSink, OutboundMessage } from "./types";

export class EventBus {
  private sink: BusSink;
  constructor(sink: BusSink) {
    this.sink = sink;
  }
  broadcast(json: string): void {
    this.sink({ kind: "broadcast", json });
  }
  toPlayer(playerId: string, json: string): void {
    this.sink({ kind: "toPlayer", playerId, json });
  }
}
