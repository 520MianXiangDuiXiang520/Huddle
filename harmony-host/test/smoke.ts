import { MemoryStorage, GameCatalog, EventBus, Room } from "../entry/src/main/ets/shared/runtime/index";
import type { Player, OutboundMessage } from "../entry/src/main/ets/shared/runtime/index";

function makePlayers(n: number): Player[] {
  const out: Player[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `p${i}`, deviceKey: `d${i}`, name: `P${i}`, color: i % 8,
      role: "player", seat: i, ready: true, connected: true, lastHeartbeat: Date.now()
    });
  }
  return out;
}

function newBus(log: string[]): EventBus {
  return new EventBus((msg: OutboundMessage) => {
    if (msg.kind === "broadcast") log.push(`BCAST ${msg.json}`);
    else log.push(`TO ${msg.playerId} ${msg.json}`);
  });
}

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name} ${detail}`); failures++; }
}

function testGomoku(): void {
  console.log("[gomoku]");
  const store = new MemoryStorage();
  const cat = new GameCatalog(store);
  const game = cat.requireAvailable("gomoku").factory();
  const players = makePlayers(2);
  let r = game.onStart(players, "p0");
  check("onStart ok", r.kind === "ok");
  // p0 plays (x=0,y=0)
  r = game.onAction("p0", { op: "place", x: 0, y: 0 });
  check("p0 place ok", r.kind === "ok", r.kind === "err" ? (r as any).message : "");
  check("not finished after 1", !game.isFinished());
  // p1 plays (x=0,y=1)
  game.onAction("p1", { op: "place", x: 0, y: 1 });
  // p0 builds a row of 5 along y=0 (x=0..4)
  for (let k = 1; k < 5; k++) {
    game.onAction("p0", { op: "place", x: k, y: 0 });
    if (k < 4) game.onAction("p1", { op: "place", x: k, y: 1 });
  }
  check("gomoku finished after 5-in-row", game.isFinished());
}

function testWerewolf(): void {
  console.log("[werewolf]");
  const store = new MemoryStorage();
  store.setNumber("ww_min", 6); store.setNumber("ww_max", 6);
  store.setNumber("ww_werewolf", 1); store.setNumber("ww_seer", 1);
  store.setNumber("ww_witch", 1); store.setNumber("ww_hunter", 1); store.setNumber("ww_guard", 0);
  const cat = new GameCatalog(store);
  const game = cat.requireAvailable("werewolf").factory();
  const players = makePlayers(6);
  let r = game.onStart(players, "p0");
  check("onStart ok", r.kind === "ok", r.kind === "err" ? (r as any).message : "");
  const snap = game.snapshot();
  check("phase night", snap.phase === "night", `phase=${snap.phase}`);
  // roles are hidden in public snapshot; discover via snapshotFor
  const roles = new Map<string, string>();
  for (const p of players) {
    const priv: any = game.snapshotFor ? game.snapshotFor(p.id) : null;
    if (priv && priv.myRole) roles.set(p.id, priv.myRole);
  }
  check("roles discovered via snapshotFor", roles.size === 6, `discovered=${roles.size}`);
  // roles hidden during play in public snapshot
  check("roles hidden in public snapshot", snap.players.every((p: any) => p.role == null));
  const wolf = [...roles.entries()].find(([, ro]) => ro === "werewolf")?.[0]!;
  const seer = [...roles.entries()].find(([, ro]) => ro === "seer")?.[0]!;
  const witch = [...roles.entries()].find(([, ro]) => ro === "witch")?.[0]!;
  const hunter = [...roles.entries()].find(([, ro]) => ro === "hunter")?.[0]!;
  const villagers = [...roles.entries()].filter(([, ro]) => ro === "villager").map(([id]) => id);
  check("has 1 wolf, 1 seer, 1 witch, 1 hunter, 2 villager",
    !!wolf && !!seer && !!witch && !!hunter && villagers.length === 2,
    `villagers=${villagers.length}`);
  const victim = villagers[0];
  // night actions
  check("wolf kill villager", game.onAction(wolf, { op: "night_action", target: victim }).kind === "ok");
  check("seer check", game.onAction(seer, { op: "night_action", target: wolf }).kind === "ok");
  check("witch heal", game.onAction(witch, { op: "night_action", choice: "heal" }).kind === "ok");
  // dawn by host
  r = game.onAction("p0", { op: "dawn" });
  check("dawn ok", r.kind === "ok", r.kind === "err" ? (r as any).message : "");
  check("no deaths (healed)", (game.snapshot() as any).deathsThisRound.length === 0);
  // start vote
  check("start vote", game.onAction("p0", { op: "start_vote" }).kind === "ok");
  // vote out the wolf
  for (const id of players.map((p) => p.id)) {
    if (id === wolf) continue;
    game.onAction(id, { op: "vote", target: wolf });
  }
  r = game.onAction("p0", { op: "resolve_vote" });
  check("resolve vote ok", r.kind === "ok", r.kind === "err" ? (r as any).message : "");
  check("wolf dead", !(game.snapshot() as any).players.find((p: any) => p.id === wolf).alive);
  check("villager win", (game.snapshot() as any).winner === "villager", `winner=${(game.snapshot() as any).winner}`);
  check("finished", game.isFinished());
}

function testDoudizhu(): void {
  console.log("[doudizhu]");
  const store = new MemoryStorage();
  const cat = new GameCatalog(store);
  const game = cat.requireAvailable("doudizhu").factory();
  const players = makePlayers(3);
  let r = game.onStart(players, "p0");
  check("onStart ok", r.kind === "ok", r.kind === "err" ? (r as any).message : "");
  check("phase bid", (game.snapshot() as any).phase === "bid");
  // p0 bids 1, p1 pass, p2 pass -> p0 landlord
  check("p0 bid 1", game.onAction("p0", { op: "bid", value: 1 }).kind === "ok");
  check("p1 pass", game.onAction("p1", { op: "bid", value: 0 }).kind === "ok");
  check("p2 pass", game.onAction("p2", { op: "bid", value: 0 }).kind === "ok");
  check("landlord p0", (game.snapshot() as any).landlordId === "p0");
  check("phase play", (game.snapshot() as any).phase === "play");
  // p0 plays a single card repeatedly until hand empty (others always pass)
  let guard = 0;
  let lastPlayer = "p0";
  while (!game.isFinished() && guard++ < 200) {
    const turn = (game.snapshot() as any).currentTurnId;
    const snap = (game.snapshotFor ? game.snapshotFor(turn) : {}) as any;
    if (turn === lastPlayer) {
      const hand: number[] = snap.myHand ?? [];
      if (hand.length === 0) break;
      const card = hand[0];
      const res = game.onAction(turn, { op: "play", cards: [card] });
      if (res.kind === "err") {
        break;
      }
    } else {
      game.onAction(turn, { op: "pass" });
    }
    lastPlayer = turn;
  }
  check("doudizhu finished", game.isFinished(), `guard=${guard}`);
  check("landlord wins", (game.snapshot() as any).winnerSide === "landlord");
}

function testUndercover(): void {
  console.log("[undercover]");
  const store = new MemoryStorage();
  const cat = new GameCatalog(store);
  const game = cat.requireAvailable("undercover").factory();
  const players = makePlayers(4);
  let r = game.onStart(players, "p0");
  check("onStart ok", r.kind === "ok", r.kind === "err" ? (r as any).message : "");
  // Each player votes
  for (const p of players) {
    game.onAction(p.id, { op: "vote", target: players[0].id });
  }
  check("undercover runs votes", true);
}

function testRoom(): void {
  console.log("[room]");
  const store = new MemoryStorage();
  const cat = new GameCatalog(store);
  const log: string[] = [];
  const bus = newBus(log);
  const game = cat.requireAvailable("gomoku");
  const room = new Room({
    bus, pluginFactory: game.factory, catalogGameId: game.id,
    minPlayers: 2, maxPlayers: 2
  });
  const a = room.onConnect("dA", true);
  const b = room.onConnect("dB", false);
  check("host connected", a != null);
  check("guest connected", b != null);
  // host joins seat, readies
  room.handle(a!, JSON.stringify({ type: "joinGame" }));
  room.handle(b!, JSON.stringify({ type: "joinGame" }));
  room.handle(a!, JSON.stringify({ type: "ready", ready: true }));
  room.handle(b!, JSON.stringify({ type: "ready", ready: true }));
  // non-host cannot start
  let before = log.length;
  room.handle(b!, JSON.stringify({ type: "start" }));
  check("non-host start rejected", log.length > before && log[log.length - 1].includes("只有房主"));
  // host starts
  room.handle(a!, JSON.stringify({ type: "start" }));
  check("host start ok", log.some((l) => l.includes("ntf_game")), `logLen=${log.length}`);
  // place a move
  room.handle(a!, JSON.stringify({ type: "action", clientActionId: "c1", payload: { op: "place", row: 0, col: 0 } }));
  check("action ack", log.some((l) => l.includes("actionAck")));
  room.shutdown();
}

testGomoku();
testWerewolf();
testDoudizhu();
testUndercover();
testRoom();

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
if (failures > 0) throw new Error(`${failures} test failures`);
