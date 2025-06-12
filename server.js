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
    this.lobbyPlayers = new Map(); // For lobby management
    this.state = 'lobby'; // lobby, playing, ended
    this.fire = new FireSimulation();
    this.civilians = [];
    this.structuralIntegrity = 100;
    this.waterSupply = 1000;
    this.startTime = null;
    this.timeLimit = 300; // 5 minutes
    this.level = this.generateLevel();
    this.lastUpdate = Date.now();
    
    // Initialize fire truck PL 511
    this.fireTruck = {
      x: 100,
      y: 500,
      waterLevel: 2000, // gallons
      maxWater: 2000,
      pumpRunning: false,
      waterPressure: 0,
      hoseConnections: [
        { occupied: false, playerId: null },
        { occupied: false, playerId: null },
        { occupied: false, playerId: null },
        { occupied: false, playerId: null }
      ]
    };
    
    // Initialize hydrant
    this.hydrant = {
      x: 200,
      y: 300,
      connected: false,
      waterPressure: 100 // PSI
    };
  }

  addLobbyPlayer(playerId, socket, playerName) {
    if (this.lobbyPlayers.size >= 4) return false;
    
    const lobbyPlayer = {
      id: playerId,
      socket: socket,
      name: playerName,
      role: null // Will be selected in lobby
    };
    
    this.lobbyPlayers.set(playerId, lobbyPlayer);
    return true;
  }

  removeLobbyPlayer(playerId) {
    this.lobbyPlayers.delete(playerId);
    if (this.lobbyPlayers.size === 0) {
      games.delete(this.id);
    }
  }

  setPlayerRole(playerId, role) {
    console.log('setPlayerRole called for player:', playerId, 'role:', role);
    const player = this.lobbyPlayers.get(playerId);
    console.log('Found player in lobby:', player);
    
    if (!player) {
      console.log('Player not found in lobby');
      return false;
    }
    
    const roleLimits = { 'pump-operator': 1, 'section-commander': 1, 'firefighter': 2 };
    
    // Count current players in the target role, excluding the current player
    const currentCount = Array.from(this.lobbyPlayers.values())
      .filter(p => p.role === role && p.id !== playerId).length;
    
    console.log('Current count for role', role, ':', currentCount, 'limit:', roleLimits[role]);
    
    if (currentCount >= roleLimits[role]) {
      console.log('Role is full');
      return false; // Role is full
    }
    
    console.log('Setting player role from', player.role, 'to', role);
    player.role = role;
    console.log('Role set successfully');
    return true;
  }

  canStartGame() {
    if (this.lobbyPlayers.size !== 4) return false;
    
    const roleCounts = {
      'pump-operator': 0,
      'section-commander': 0,
      'firefighter': 0
    };
    
    this.lobbyPlayers.forEach(player => {
      if (player.role) {
        roleCounts[player.role]++;
      }
    });
    
    return roleCounts['pump-operator'] === 1 && 
           roleCounts['section-commander'] === 1 && 
           roleCounts['firefighter'] === 2;
  }

  startGameFromLobby() {
    if (!this.canStartGame()) return false;
    
    // Convert lobby players to game players
    const spawnPositions = [
      { x: 150, y: 450 }, // Near fire truck
      { x: 180, y: 450 },
      { x: 210, y: 450 },
      { x: 240, y: 450 }
    ];
    
    let positionIndex = 0;
    this.lobbyPlayers.forEach(lobbyPlayer => {
      const position = spawnPositions[positionIndex++];
      const player = {
        id: lobbyPlayer.id,
        socket: lobbyPlayer.socket,
        name: lobbyPlayer.name,
        x: position.x,
        y: position.y,
        role: lobbyPlayer.role,
        health: 100,
        water: 100,
        isAlive: true,
        hose: {
          connected: false,
          connectionPoint: null,
          connectionType: null,
          segments: [],
          maxLength: 300,
          strained: false,
          waterPressure: 0
        }
      };
      
      this.players.set(lobbyPlayer.id, player);
    });
    
    this.lobbyPlayers.clear();
    this.state = 'playing';
    this.startTime = Date.now();
    this.initializeFire();
    this.spawnCivilians();
    return true;
  }

  getLobbyState() {
    return {
      id: this.id,
      state: this.state,
      players: Array.from(this.lobbyPlayers.values()).map(p => ({
        id: p.id,
        name: p.name,
        role: p.role
      }))
    };
  }

  addPlayer(playerId, socket) {
    // This is now only used for direct game joining (legacy)
    if (this.players.size >= 4) return false;
    
    const roles = ['pump-operator', 'section-commander', 'firefighter', 'firefighter'];
    const usedRoles = Array.from(this.players.values()).map(p => p.role);
    const availableRoles = roles.filter(role => !usedRoles.includes(role));
    
    const player = {
      id: playerId,
      socket: socket,
      x: 100 + this.players.size * 50,
      y: 100,
      role: availableRoles[0] || 'firefighter',
      health: 100,
      water: 100,
      isAlive: true,
      hose: {
        connected: false,
        connectionPoint: null,
        connectionType: null, // 'truck' or 'hydrant'
        segments: [],
        maxLength: 300, // feet (converted to pixels: ~1200px)
        strained: false,
        waterPressure: 0
      }
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
    // Legacy method for direct game start
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
        isAlive: p.isAlive,
        hose: p.hose
      })),
      fire: this.fire.getState(),
      civilians: this.civilians,
      structuralIntegrity: this.structuralIntegrity,
      waterSupply: this.waterSupply,
      level: this.level,
      fireTruck: this.fireTruck,
      hydrant: this.hydrant,
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
    // Performance optimization: only update every few frames
    this.updateCounter = (this.updateCounter || 0) + 1;
    if (this.updateCounter % 2 !== 0) return; // Skip every other update
    
    // Only process cells that have fire or are adjacent to fire
    if (!this.activeCells) this.activeCells = new Set();
    if (!this.cellsToUpdate) this.cellsToUpdate = [];
    
    // Clear and reuse existing arrays/sets for better memory management
    this.activeCells.clear();
    this.cellsToUpdate.length = 0;
    
    // Find all cells with fire and their neighbors
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.grid[y][x].intensity > 0.05) {
          // Add this cell and all neighbors to update list
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (this.isValidPosition(nx, ny)) {
                const key = `${nx},${ny}`;
                if (!this.activeCells.has(key)) {
                  this.activeCells.add(key);
                  this.cellsToUpdate.push([nx, ny]);
                }
              }
            }
          }
        }
      }
    }
    
    // Only update active cells for massive performance boost
    this.cellsToUpdate.forEach(([x, y]) => {
      const cell = this.grid[y][x];
      
      if (cell.intensity > 0.05) {
        // Fire consumes fuel and oxygen
        cell.fuel = Math.max(0, cell.fuel - deltaTime * 0.08);
        cell.oxygen = Math.max(0, cell.oxygen - deltaTime * 0.15);
        
        // Fire dies without fuel or oxygen
        if (cell.fuel <= 0 || cell.oxygen <= 0) {
          cell.intensity = Math.max(0, cell.intensity - deltaTime * 1.5);
          cell.temperature = Math.max(20, cell.temperature - deltaTime * 25);
        }
        
        // Simplified fire spread - only to direct neighbors
        if (cell.intensity > 0.3) {
          const neighbors = [[x-1, y], [x+1, y], [x, y-1], [x, y+1]];
          
          neighbors.forEach(([nx, ny]) => {
            if (this.isValidPosition(nx, ny)) {
              const neighbor = this.grid[ny][nx];
              if (neighbor.fuel > 0.2 && neighbor.oxygen > 0.2 && neighbor.intensity < 0.1) {
                const heatTransfer = cell.intensity * deltaTime * 0.2;
                neighbor.temperature += heatTransfer * 15;
                if (neighbor.temperature > 70) {
                  neighbor.intensity = Math.min(0.6, (neighbor.temperature - 70) / 30);
                }
              }
            }
          });
        }
      } else if (cell.temperature > 25) {
        // Cool down over time
        cell.temperature = Math.max(20, cell.temperature - deltaTime * 3);
      }
    });
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
  
  socket.on('joinLobby', (data) => {
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
    
    if (game.state === 'lobby' && game.addLobbyPlayer(socket.id, socket, playerName)) {
      players.set(socket.id, { gameId: game.id, playerName, inLobby: true });
      socket.join(game.id);
      
      socket.emit('lobbyJoined', {
        gameId: game.id,
        playerId: socket.id,
        lobbyState: game.getLobbyState()
      });
      
      game.broadcast('lobbyUpdated', game.getLobbyState());
    } else {
      socket.emit('error', { message: 'Lobby is full or game already started' });
    }
  });

  socket.on('selectRole', (data) => {
    console.log('selectRole received from', socket.id, 'data:', data);
    const playerInfo = players.get(socket.id);
    console.log('playerInfo:', playerInfo);
    
    if (!playerInfo || !playerInfo.inLobby) {
      console.log('Player not found or not in lobby');
      return;
    }
    
    const game = games.get(playerInfo.gameId);
    console.log('game found:', game ? game.id : 'none');
    
    if (!game || game.state !== 'lobby') {
      console.log('Game not found or not in lobby state');
      return;
    }
    
    const { role } = data;
    console.log('Attempting to set role:', role, 'for player:', socket.id);
    
    if (game.setPlayerRole(socket.id, role)) {
      console.log('Role set successfully, broadcasting lobby update');
      const lobbyState = game.getLobbyState();
      console.log('Broadcasting lobbyState:', lobbyState);
      game.broadcast('lobbyUpdated', lobbyState);
    } else {
      console.log('Role setting failed - role full');
      socket.emit('error', { message: 'Role is already full' });
    }
  });

  socket.on('startGame', (data) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo || !playerInfo.inLobby) return;
    
    const game = games.get(playerInfo.gameId);
    if (!game || game.state !== 'lobby') return;
    
    if (game.startGameFromLobby()) {
      // Update player info to indicate they're now in game
      game.players.forEach((player, playerId) => {
        const playerInfo = players.get(playerId);
        if (playerInfo) {
          playerInfo.inLobby = false;
        }
      });
      
      game.broadcast('gameJoined', {
        gameId: game.id,
        gameState: game.getGameState()
      });
    } else {
      socket.emit('error', { message: 'Cannot start game - not all roles filled' });
    }
  });

  socket.on('leaveLobby', (data) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo || !playerInfo.inLobby) return;
    
    const game = games.get(playerInfo.gameId);
    if (game) {
      game.removeLobbyPlayer(socket.id);
      game.broadcast('lobbyUpdated', game.getLobbyState());
    }
    players.delete(socket.id);
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
  
  socket.on('toggleHoseConnection', (data) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo) return;
    
    const game = games.get(playerInfo.gameId);
    if (!game || game.state !== 'playing') return;
    
    const player = game.players.get(socket.id);
    if (!player) return;
    
    if (player.hose.connected) {
      // Free up connection point before disconnecting
      if (player.hose.connectionType === 'truck') {
        const connection = game.fireTruck.hoseConnections.find(c => c.playerId === socket.id);
        if (connection) {
          connection.occupied = false;
          connection.playerId = null;
        }
      }
      
      // Disconnect hose
      player.hose.connected = false;
      player.hose.connectionPoint = null;
      player.hose.connectionType = null;
      player.hose.segments = [];
      player.hose.waterPressure = 0;
    } else {
      // Try to connect to nearest fire truck or hydrant
      const connectionDistance = 50;
      
      // Check fire truck connections
      const truckDistance = Math.sqrt(
        Math.pow(player.x - game.fireTruck.x, 2) + 
        Math.pow(player.y - game.fireTruck.y, 2)
      );
      
      if (truckDistance < connectionDistance) {
        const availableConnection = game.fireTruck.hoseConnections.find(c => !c.occupied);
        if (availableConnection) {
          player.hose.connected = true;
          player.hose.connectionPoint = { x: game.fireTruck.x + 30, y: game.fireTruck.y + 20 };
          player.hose.connectionType = 'truck';
          player.hose.segments = [{ x: player.x, y: player.y }];
          availableConnection.occupied = true;
          availableConnection.playerId = socket.id;
        }
      } else {
        // Check hydrant connection
        const hydrantDistance = Math.sqrt(
          Math.pow(player.x - game.hydrant.x, 2) + 
          Math.pow(player.y - game.hydrant.y, 2)
        );
        
        if (hydrantDistance < connectionDistance) {
          player.hose.connected = true;
          player.hose.connectionPoint = { x: game.hydrant.x, y: game.hydrant.y };
          player.hose.connectionType = 'hydrant';
          player.hose.segments = [{ x: player.x, y: player.y }];
          game.hydrant.connected = true;
        }
      }
    }
    
    game.broadcast('hoseConnectionToggled', {
      playerId: socket.id,
      connected: player.hose.connected,
      connectionType: player.hose.connectionType
    });
  });
  
  socket.on('extendHose', (data) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo) return;
    
    const game = games.get(playerInfo.gameId);
    if (!game || game.state !== 'playing') return;
    
    const player = game.players.get(socket.id);
    if (!player || !player.hose.connected) return;
    
    const { x, y } = data;
    
    // Add new hose segment at current position
    player.hose.segments.push({ x, y });
    
    // Limit number of segments (for performance)
    if (player.hose.segments.length > 20) {
      player.hose.segments.shift();
    }
    
    game.broadcast('hoseExtended', {
      playerId: socket.id,
      segments: player.hose.segments
    });
  });
  
  socket.on('retractHose', (data) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo) return;
    
    const game = games.get(playerInfo.gameId);
    if (!game || game.state !== 'playing') return;
    
    const player = game.players.get(socket.id);
    if (!player || !player.hose.connected) return;
    
    // Remove last segment
    if (player.hose.segments.length > 1) {
      player.hose.segments.pop();
    }
    
    game.broadcast('hoseRetracted', {
      playerId: socket.id,
      segments: player.hose.segments
    });
  });
  
  socket.on('refillWater', (data) => {
    const playerInfo = players.get(socket.id);
    if (!playerInfo) return;
    
    const game = games.get(playerInfo.gameId);
    if (!game || game.state !== 'playing') return;
    
    const player = game.players.get(socket.id);
    if (!player) return;
    
    // Refill water from connected source
    if (player.hose.connected && player.hose.connectionType === 'truck') {
      if (game.fireTruck.waterLevel > 0) {
        const refillAmount = Math.min(20, 100 - player.water, game.fireTruck.waterLevel);
        player.water += refillAmount;
        game.fireTruck.waterLevel -= refillAmount;
      }
    } else if (player.hose.connected && player.hose.connectionType === 'hydrant') {
      // Hydrant has unlimited water
      player.water = 100;
    }
    
    game.broadcast('waterRefilled', {
      playerId: socket.id,
      waterLevel: player.water,
      truckWaterLevel: game.fireTruck.waterLevel
    });
  });
  
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    
    const playerInfo = players.get(socket.id);
    if (playerInfo) {
      const game = games.get(playerInfo.gameId);
      if (game) {
        if (playerInfo.inLobby) {
          game.removeLobbyPlayer(socket.id);
          game.broadcast('lobbyUpdated', game.getLobbyState());
        } else {
          game.removePlayer(socket.id);
          game.broadcast('playerLeft', { playerId: socket.id });
        }
      }
      players.delete(socket.id);
    }
  });
});

// Game loop - reduced frequency for better performance
setInterval(() => {
  games.forEach(game => {
    game.update();
  });
}, 1000 / 10); // 10 FPS for game logic

// Separate slower network updates
setInterval(() => {
  games.forEach(game => {
    if (game.state === 'playing') {
      game.broadcast('gameStateUpdate', game.getGameState());
    }
  });
}, 1000 / 5); // 5 FPS for network updates

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Station 51 server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to play`);
}); 