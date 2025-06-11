const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static('public'));

// Game state management
const games = new Map();
const players = new Map();

class Game {
  constructor(id) {
    this.id = id;
    this.players = new Map();
    this.state = 'waiting'; // waiting, playing, ended
    this.fire = new FireSimulation();
    this.civilians = [];
    this.structuralIntegrity = 100;
    this.waterSupply = 1000;
    this.startTime = null;
    this.timeLimit = 300; // 5 minutes
    this.level = this.generateLevel();
    this.lastUpdate = Date.now();
  }

  addPlayer(playerId, socket) {
    if (this.players.size >= 4) return false;
    
    const roles = ['axe', 'extinguisher', 'medic', 'engineer'];
    const usedRoles = Array.from(this.players.values()).map(p => p.role);
    const availableRoles = roles.filter(role => !usedRoles.includes(role));
    
    const player = {
      id: playerId,
      socket: socket,
      x: 100 + this.players.size * 50,
      y: 100,
      role: availableRoles[0] || 'axe',
      health: 100,
      water: 100,
      isAlive: true
    };
    
    this.players.set(playerId, player);
    return true;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    if (this.players.size === 0) {
      games.delete(this.id);
    }
  }

  startGame() {
    if (this.players.size < 1) return false;
    this.state = 'playing';
    this.startTime = Date.now();
    this.initializeFire();
    this.spawnCivilians();
    return true;
  }

  generateLevel() {
    const width = 40;
    const height = 30;
    const level = [];
    
    // Create walls and floors
    for (let y = 0; y < height; y++) {
      level[y] = [];
      for (let x = 0; x < width; x++) {
        if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
          level[y][x] = { type: 'wall', passable: false };
        } else if (Math.random() < 0.1) {
          level[y][x] = { type: 'wall', passable: false };
        } else {
          level[y][x] = { type: 'floor', passable: true };
        }
      }
    }
    
    // Add doors and hydrants
    for (let i = 0; i < 3; i++) {
      const x = Math.floor(Math.random() * (width - 2)) + 1;
      const y = Math.floor(Math.random() * (height - 2)) + 1;
      if (level[y][x].type === 'floor') {
        level[y][x] = { type: 'hydrant', passable: true };
      }
    }
    
    return { width, height, tiles: level };
  }

  initializeFire() {
    const hotspots = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < hotspots; i++) {
      const x = Math.floor(Math.random() * this.level.width);
      const y = Math.floor(Math.random() * this.level.height);
      if (this.level.tiles[y] && this.level.tiles[y][x] && this.level.tiles[y][x].passable) {
        this.fire.ignite(x, y, 80);
      }
    }
  }

  spawnCivilians() {
    const count = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const x = Math.floor(Math.random() * this.level.width);
      const y = Math.floor(Math.random() * this.level.height);
      if (this.level.tiles[y] && this.level.tiles[y][x] && this.level.tiles[y][x].passable) {
        this.civilians.push({
          id: uuidv4(),
          x: x * 20,
          y: y * 20,
          health: 100,
          rescued: false,
          unconscious: false
        });
      }
    }
  }

  update() {
    if (this.state !== 'playing') return;
    
    const now = Date.now();
    const deltaTime = (now - this.lastUpdate) / 1000;
    this.lastUpdate = now;
    
    // Update fire simulation
    this.fire.update(deltaTime);
    
    // Update civilians (smoke damage)
    this.civilians.forEach(civilian => {
      if (!civilian.rescued && !civilian.unconscious) {
        const fireIntensity = this.fire.getIntensityAt(
          Math.floor(civilian.x / 20), 
          Math.floor(civilian.y / 20)
        );
        if (fireIntensity > 0.3) {
          civilian.health -= fireIntensity * deltaTime * 10;
          if (civilian.health <= 0) {
            civilian.unconscious = true;
          }
        }
      }
    });
    
    // Update structural integrity
    const totalFire = this.fire.getTotalIntensity();
    if (totalFire > 0) {
      this.structuralIntegrity -= totalFire * deltaTime * 0.5;
    }
    
    // Check win/lose conditions
    const timeElapsed = (now - this.startTime) / 1000;
    const remainingTime = this.timeLimit - timeElapsed;
    
    if (this.structuralIntegrity <= 0 || remainingTime <= 0) {
      this.endGame('defeat');
    } else if (this.fire.getTotalIntensity() < 0.1 && this.civilians.filter(c => c.rescued).length >= Math.ceil(this.civilians.length * 0.7)) {
      this.endGame('victory');
    }
  }

  endGame(result) {
    this.state = 'ended';
    this.broadcast('gameEnded', { result, stats: this.getStats() });
  }

  getStats() {
    const timeElapsed = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
    return {
      timeElapsed,
      structuralIntegrity: this.structuralIntegrity,
      civiliansRescued: this.civilians.filter(c => c.rescued).length,
      totalCivilians: this.civilians.length,
      waterUsed: 1000 - this.waterSupply
    };
  }

  broadcast(event, data) {
    this.players.forEach(player => {
      player.socket.emit(event, data);
    });
  }

  getGameState() {
    return {
      id: this.id,
      state: this.state,
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        x: p.x,
        y: p.y,
        role: p.role,
        health: p.health,
        water: p.water,
        isAlive: p.isAlive
      })),
      fire: this.fire.getState(),
      civilians: this.civilians,
      structuralIntegrity: this.structuralIntegrity,
      waterSupply: this.waterSupply,
      level: this.level,
      timeRemaining: this.startTime ? Math.max(0, this.timeLimit - (Date.now() - this.startTime) / 1000) : this.timeLimit
    };
  }
}

class FireSimulation {
  constructor() {
    this.width = 40;
    this.height = 30;
    this.grid = [];
    this.initializeGrid();
  }

  initializeGrid() {
    for (let y = 0; y < this.height; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x] = {
          temperature: 20, // Celsius
          fuel: 0.8, // 0-1, flammability
          oxygen: 1.0, // 0-1
          intensity: 0 // 0-1, current fire intensity
        };
      }
    }
  }

  ignite(x, y, temperature = 100) {
    if (this.isValidPosition(x, y)) {
      this.grid[y][x].temperature = temperature;
      this.grid[y][x].intensity = Math.min(1, temperature / 100);
    }
  }

  extinguish(x, y, amount = 0.5) {
    if (this.isValidPosition(x, y)) {
      this.grid[y][x].temperature = Math.max(20, this.grid[y][x].temperature - amount * 50);
      this.grid[y][x].intensity = Math.max(0, this.grid[y][x].intensity - amount);
    }
  }

  isValidPosition(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  update(deltaTime) {
    const newGrid = JSON.parse(JSON.stringify(this.grid));
    
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];
        
        if (cell.intensity > 0) {
          // Fire consumes fuel and oxygen
          newGrid[y][x].fuel = Math.max(0, cell.fuel - deltaTime * 0.1);
          newGrid[y][x].oxygen = Math.max(0, cell.oxygen - deltaTime * 0.2);
          
          // Fire dies without fuel or oxygen
          if (newGrid[y][x].fuel <= 0 || newGrid[y][x].oxygen <= 0) {
            newGrid[y][x].intensity = Math.max(0, cell.intensity - deltaTime * 2);
            newGrid[y][x].temperature = Math.max(20, cell.temperature - deltaTime * 30);
          }
          
          // Fire spreads to neighbors
          const neighbors = [
            [x-1, y], [x+1, y], [x, y-1], [x, y+1]
          ];
          
          neighbors.forEach(([nx, ny]) => {
            if (this.isValidPosition(nx, ny)) {
              const neighbor = this.grid[ny][nx];
              if (neighbor.fuel > 0.1 && neighbor.oxygen > 0.1 && neighbor.intensity < 0.1) {
                const heatTransfer = cell.intensity * deltaTime * 0.3;
                newGrid[ny][nx].temperature += heatTransfer * 20;
                if (newGrid[ny][nx].temperature > 60) {
                  newGrid[ny][nx].intensity = Math.min(1, (newGrid[ny][nx].temperature - 60) / 40);
                }
              }
            }
          });
        } else {
          // Cool down over time
          newGrid[y][x].temperature = Math.max(20, cell.temperature - deltaTime * 5);
        }
      }
    }
    
    this.grid = newGrid;
  }

  getIntensityAt(x, y) {
    if (this.isValidPosition(x, y)) {
      return this.grid[y][x].intensity;
    }
    return 0;
  }

  getTotalIntensity() {
    let total = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        total += this.grid[y][x].intensity;
      }
    }
    return total;
  }

  getState() {
    return this.grid;
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  socket.on('joinGame', (data) => {
    const { gameId, playerName } = data;
    
    let game;
    if (gameId && games.has(gameId)) {
      game = games.get(gameId);
    } else {
      // Create new game
      const newGameId = uuidv4();
      game = new Game(newGameId);
      games.set(newGameId, game);
    }
    
    if (game.addPlayer(socket.id, socket)) {
      players.set(socket.id, { gameId: game.id, playerName });
      socket.join(game.id);
      
      socket.emit('gameJoined', {
        gameId: game.id,
        playerId: socket.id,
        gameState: game.getGameState()
      });
      
      game.broadcast('playerJoined', {
        playerId: socket.id,
        playerName: playerName
      });
      
      // Start game if enough players
      if (game.players.size >= 1 && game.state === 'waiting') {
        setTimeout(() => {
          if (game.startGame()) {
            game.broadcast('gameStarted', game.getGameState());
          }
        }, 2000);
      }
    } else {
      socket.emit('error', { message: 'Game is full' });
    }
  });
  
  socket.on('playerMove', (data) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo) return;
    
    const game = games.get(playerInfo.gameId);
    if (!game || game.state !== 'playing') return;
    
    const player = game.players.get(socket.id);
    if (!player) return;
    
    player.x = Math.max(0, Math.min(800, data.x));
    player.y = Math.max(0, Math.min(600, data.y));
    
    game.broadcast('playerMoved', {
      playerId: socket.id,
      x: player.x,
      y: player.y
    });
  });
  
  socket.on('sprayWater', (data) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo) return;
    
    const game = games.get(playerInfo.gameId);
    if (!game || game.state !== 'playing') return;
    
    const player = game.players.get(socket.id);
    if (!player || player.water <= 0) return;
    
    const { x, y, direction } = data;
    
    // Calculate spray area
    const sprayDistance = 60;
    const sprayWidth = 30;
    const endX = x + Math.cos(direction) * sprayDistance;
    const endY = y + Math.sin(direction) * sprayDistance;
    
    // Extinguish fire in spray area
    const gridX = Math.floor(endX / 20);
    const gridY = Math.floor(endY / 20);
    
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        game.fire.extinguish(gridX + dx, gridY + dy, 0.3);
      }
    }
    
    player.water = Math.max(0, player.water - 2);
    
    game.broadcast('waterSprayed', {
      playerId: socket.id,
      x: x,
      y: y,
      endX: endX,
      endY: endY,
      direction: direction
    });
  });
  
  socket.on('rescueCivilian', (data) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo) return;
    
    const game = games.get(playerInfo.gameId);
    if (!game || game.state !== 'playing') return;
    
    const { civilianId } = data;
    const civilian = game.civilians.find(c => c.id === civilianId);
    
    if (civilian && !civilian.rescued) {
      civilian.rescued = true;
      game.broadcast('civilianRescued', { civilianId });
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    
    const playerInfo = players.get(socket.id);
    if (playerInfo) {
      const game = games.get(playerInfo.gameId);
      if (game) {
        game.removePlayer(socket.id);
        game.broadcast('playerLeft', { playerId: socket.id });
      }
      players.delete(socket.id);
    }
  });
});

// Game loop
setInterval(() => {
  games.forEach(game => {
    game.update();
    if (game.state === 'playing') {
      game.broadcast('gameStateUpdate', game.getGameState());
    }
  });
}, 1000 / 30); // 30 FPS

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Station 51 server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play`);
}); 