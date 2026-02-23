const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// Game config
const CELL_SIZE = 16;
const GRID_WIDTH = 50; // 50 * 16 = 800 px
const GRID_HEIGHT = 37; // 37 * 16 = 592 px
const TICK_MS = 80;
const INITIAL_LENGTH = 6;
const FOOD_COUNT = 50;

const players = {}; // id -> { segments, dir, nextDir, color, score, name, skin }
let foods = [];

function randomGridPos() {
  return {
    x: Math.floor(Math.random() * GRID_WIDTH),
    y: Math.floor(Math.random() * GRID_HEIGHT),
  };
}

// Default color per skin - used mainly for glow
function defaultColorForSkin(skinId) {
  switch (skinId) {
    case "pink":
      return "#ff77aa";
    case "dragon":
      return "#3498db";
    case "mint":
      return "#2ecc71";
    case "sunny":
      return "#f1c40f";
    case "hotdog":
      return "#d35400";
    case "icecream":
      return "#f5b7b1";
    case "rainbow":
      return "#ffffff";
    case "galaxy":
      return "#8e44ad";
    case "burger":
      return "#d68910";
    case "dragon2": // blue and black dragon
      return "#0a84ff";
    default:
      return "#1abc9c";
  }
}

function isOccupied(x, y) {
  for (const id in players) {
    const p = players[id];
    for (const seg of p.segments) {
      if (seg.x === x && seg.y === y) return true;
    }
  }
  return false;
}

function spawnFood() {
  let tries = 0;
  let pos;
  do {
    pos = randomGridPos();
    tries++;
    if (tries > 200) break;
  } while (isOccupied(pos.x, pos.y));
  foods.push({ x: pos.x, y: pos.y, value: 1 });
}

function ensureFoods() {
  while (foods.length < FOOD_COUNT) {
    spawnFood();
  }
}

function createPlayer(id, name, skinId) {
  const startPos = randomGridPos();
  const segments = [];
  for (let i = 0; i < INITIAL_LENGTH; i++) {
    segments.push({ x: startPos.x - i, y: startPos.y });
  }
  const skin = skinId || "mint";
  players[id] = {
    id,
    name: name || "Player",
    skin,
    segments,
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },
    color: defaultColorForSkin(skin),
    score: 0,
    alive: true,
    growAmount: 0,
  };
}

function resetPlayer(p) {
  const startPos = randomGridPos();
  const segments = [];
  for (let i = 0; i < INITIAL_LENGTH; i++) {
    segments.push({ x: startPos.x - i, y: startPos.y });
  }
  p.segments = segments;
  p.dir = { x: 1, y: 0 };
  p.nextDir = { x: 1, y: 0 };
  p.score = 0;
  p.growAmount = 0;
  p.alive = true;
}

io.on("connection", (socket) => {
  console.log("Player connected", socket.id);

  socket.on("join", (payload) => {
    const name = (payload && payload.name) || "Player";
    const skin = (payload && payload.skin) || "mint";
    createPlayer(socket.id, name, skin);
    socket.emit("joined", { id: socket.id });
  });

  socket.on("dir", (dir) => {
    const p = players[socket.id];
    if (!p) return;
    const { x, y } = dir || {};
    if (typeof x !== "number" || typeof y !== "number") return;

    // prevent instant reversal
    if (x === -p.dir.x && y === -p.dir.y) return;

    p.nextDir = { x, y };
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected", socket.id);
    delete players[socket.id];
  });
});

// Main game loop
function tick() {
  ensureFoods();

  // Move players
  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;

    p.dir = { ...p.nextDir };
    const head = p.segments[0];
    let newX = (head.x + p.dir.x + GRID_WIDTH) % GRID_WIDTH;
    let newY = (head.y + p.dir.y + GRID_HEIGHT) % GRID_HEIGHT;
    const newHead = { x: newX, y: newY };
    p.segments.unshift(newHead);

    if (p.growAmount > 0) {
      p.growAmount--;
    } else {
      p.segments.pop();
    }
  }

  // Eat food
  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;
    const head = p.segments[0];
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      if (f.x === head.x && f.y === head.y) {
        foods.splice(i, 1);
        p.growAmount += f.value;
        p.score += f.value;
      }
    }
  }

  // Collisions: if a head hits any body segment
  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;
    const head = p.segments[0];

    for (const otherId in players) {
      const o = players[otherId];
      if (!o.alive) continue;

      const startIndex = o === p ? 1 : 0;
      for (let i = startIndex; i < o.segments.length; i++) {
        const seg = o.segments[i];
        if (seg.x === head.x && seg.y === head.y) {
          // p died by hitting a body
          p.alive = false;
          // turn p into food
          for (let j = 0; j < p.segments.length; j++) {
            const seg2 = p.segments[j];
            foods.push({ x: seg2.x, y: seg2.y, value: j === 0 ? 2 : 1 });
          }
          resetPlayer(p);
          break;
        }
      }
    }
  }

  // Broadcast state
  const payload = {
    players: Object.values(players).map((p) => ({
      id: p.id,
      name: p.name,
      segments: p.segments,
      color: p.color,
      score: p.score,
      skin: p.skin,
    })),
    foods,
    grid: { w: GRID_WIDTH, h: GRID_HEIGHT, cell: CELL_SIZE },
  };

  io.emit("state", payload);
}

setInterval(tick, TICK_MS);

server.listen(PORT, () => {
  console.log("YummySnake.io server running on port", PORT);
});
