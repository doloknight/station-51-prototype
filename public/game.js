// Station 51 - Client-side Game Logic
class Game {
    constructor() {
        this.socket = null;
        this.gameId = null;
        this.playerId = null;
        this.gameState = null;
        this.canvas = null;
        this.ctx = null;
        this.keys = {};
        this.mouse = { x: 0, y: 0, down: false };
        this.camera = { x: 0, y: 0 };
        this.waterSprayEffects = [];
        this.lastUpdate = Date.now();
        
        this.init();
    }
    
    init() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Socket connection
        this.socket = io();
        this.setupSocketListeners();
        
        // Input handlers
        this.setupInputHandlers();
        
        // Start render loop
        this.render();
    }
    
    setupSocketListeners() {
        this.socket.on('gameJoined', (data) => {
            console.log('Joined game:', data);
            this.gameId = data.gameId;
            this.playerId = data.playerId;
            this.gameState = data.gameState;
            
            document.getElementById('joinForm').style.display = 'none';
            document.getElementById('gameCanvas').style.display = 'block';
            document.getElementById('ui').style.display = 'block';
            document.getElementById('controls').style.display = 'block';
            
            this.updateUI();
        });
        
        this.socket.on('gameStarted', (gameState) => {
            console.log('Game started!');
            this.gameState = gameState;
            this.updateUI();
        });
        
        this.socket.on('gameStateUpdate', (gameState) => {
            this.gameState = gameState;
            this.updateUI();
        });
        
        this.socket.on('playerMoved', (data) => {
            if (this.gameState && this.gameState.players) {
                const player = this.gameState.players.find(p => p.id === data.playerId);
                if (player) {
                    player.x = data.x;
                    player.y = data.y;
                }
            }
        });
        
        this.socket.on('waterSprayed', (data) => {
            this.addWaterSprayEffect(data);
        });
        
        this.socket.on('civilianRescued', (data) => {
            if (this.gameState) {
                const civilian = this.gameState.civilians.find(c => c.id === data.civilianId);
                if (civilian) {
                    civilian.rescued = true;
                }
            }
        });
        
        this.socket.on('gameEnded', (data) => {
            this.showGameEndModal(data.result, data.stats);
        });
        
        this.socket.on('error', (data) => {
            alert(data.message);
        });
    }
    
    setupInputHandlers() {
        // Keyboard input
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            
            if (e.code === 'Space') {
                e.preventDefault();
                this.tryRescueCivilian();
            }
            
            if (e.code === 'KeyR') {
                this.tryRefillWater();
            }
        });
        
        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });
        
        // Mouse input
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.mouse.x = e.clientX - rect.left;
            this.mouse.y = e.clientY - rect.top;
        });
        
        this.canvas.addEventListener('mousedown', (e) => {
            this.mouse.down = true;
            this.sprayWater();
        });
        
        this.canvas.addEventListener('mouseup', (e) => {
            this.mouse.down = false;
        });
        
        // Prevent context menu
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });
    }
    
    update() {
        if (!this.gameState || this.gameState.state !== 'playing') return;
        
        const now = Date.now();
        const deltaTime = (now - this.lastUpdate) / 1000;
        this.lastUpdate = now;
        
        // Handle movement
        this.handleMovement();
        
        // Update water spray effects
        this.updateWaterSprayEffects(deltaTime);
        
        // Update camera to follow player
        this.updateCamera();
    }
    
    handleMovement() {
        if (!this.gameState || !this.playerId) return;
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player) return;
        
        let dx = 0, dy = 0;
        const speed = 150; // pixels per second
        
        if (this.keys['KeyW'] || this.keys['ArrowUp']) dy -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) dy += 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) dx -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) dx += 1;
        
        if (dx !== 0 || dy !== 0) {
            // Normalize diagonal movement
            if (dx !== 0 && dy !== 0) {
                dx *= 0.707;
                dy *= 0.707;
            }
            
            const newX = player.x + dx * speed * (1/60); // Assume 60 FPS
            const newY = player.y + dy * speed * (1/60);
            
            // Simple bounds checking
            const boundedX = Math.max(20, Math.min(780, newX));
            const boundedY = Math.max(20, Math.min(580, newY));
            
            if (boundedX !== player.x || boundedY !== player.y) {
                this.socket.emit('playerMove', { x: boundedX, y: boundedY });
            }
        }
    }
    
    sprayWater() {
        if (!this.gameState || !this.playerId) return;
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player || player.water <= 0) return;
        
        // Calculate direction from player to mouse
        const playerScreenX = player.x - this.camera.x;
        const playerScreenY = player.y - this.camera.y;
        
        const dx = this.mouse.x - playerScreenX;
        const dy = this.mouse.y - playerScreenY;
        const direction = Math.atan2(dy, dx);
        
        this.socket.emit('sprayWater', {
            x: player.x,
            y: player.y,
            direction: direction
        });
    }
    
    tryRescueCivilian() {
        if (!this.gameState || !this.playerId) return;
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player) return;
        
        // Find nearby civilians
        const rescueDistance = 40;
        this.gameState.civilians.forEach(civilian => {
            if (!civilian.rescued) {
                const distance = Math.sqrt(
                    Math.pow(player.x - civilian.x, 2) + 
                    Math.pow(player.y - civilian.y, 2)
                );
                
                if (distance < rescueDistance) {
                    this.socket.emit('rescueCivilian', { civilianId: civilian.id });
                }
            }
        });
    }
    
    tryRefillWater() {
        if (!this.gameState || !this.playerId) return;
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player) return;
        
        // Check if near hydrant (simplified - would need proper level collision)
        console.log('Trying to refill water...');
        // This would be implemented with proper hydrant collision detection
    }
    
    addWaterSprayEffect(data) {
        this.waterSprayEffects.push({
            startX: data.x,
            startY: data.y,
            endX: data.endX,
            endY: data.endY,
            lifetime: 0.5, // seconds
            maxLifetime: 0.5
        });
    }
    
    updateWaterSprayEffects(deltaTime) {
        this.waterSprayEffects = this.waterSprayEffects.filter(effect => {
            effect.lifetime -= deltaTime;
            return effect.lifetime > 0;
        });
    }
    
    updateCamera() {
        if (!this.gameState || !this.playerId) return;
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (player) {
            // Center camera on player
            this.camera.x = player.x - this.canvas.width / 2;
            this.camera.y = player.y - this.canvas.height / 2;
            
            // Keep camera in bounds
            this.camera.x = Math.max(0, Math.min(800 - this.canvas.width, this.camera.x));
            this.camera.y = Math.max(0, Math.min(600 - this.canvas.height, this.camera.y));
        }
    }
    
    render() {
        this.update();
        
        // Clear canvas
        this.ctx.fillStyle = '#2a2a2a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        if (this.gameState) {
            this.renderLevel();
            this.renderFire();
            this.renderCivilians();
            this.renderPlayers();
            this.renderWaterSprayEffects();
        }
        
        requestAnimationFrame(() => this.render());
    }
    
    renderLevel() {
        if (!this.gameState.level) return;
        
        const { width, height, tiles } = this.gameState.level;
        const tileSize = 20;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const tile = tiles[y][x];
                const screenX = x * tileSize - this.camera.x;
                const screenY = y * tileSize - this.camera.y;
                
                // Skip rendering if off-screen
                if (screenX < -tileSize || screenX > this.canvas.width || 
                    screenY < -tileSize || screenY > this.canvas.height) {
                    continue;
                }
                
                switch (tile.type) {
                    case 'wall':
                        this.ctx.fillStyle = '#666';
                        this.ctx.fillRect(screenX, screenY, tileSize, tileSize);
                        this.ctx.strokeStyle = '#444';
                        this.ctx.strokeRect(screenX, screenY, tileSize, tileSize);
                        break;
                    case 'floor':
                        this.ctx.fillStyle = '#444';
                        this.ctx.fillRect(screenX, screenY, tileSize, tileSize);
                        break;
                    case 'hydrant':
                        this.ctx.fillStyle = '#444';
                        this.ctx.fillRect(screenX, screenY, tileSize, tileSize);
                        this.ctx.fillStyle = '#4444ff';
                        this.ctx.fillRect(screenX + 4, screenY + 4, tileSize - 8, tileSize - 8);
                        break;
                }
            }
        }
    }
    
    renderFire() {
        if (!this.gameState.fire) return;
        
        const tileSize = 20;
        
        this.gameState.fire.forEach((row, y) => {
            row.forEach((cell, x) => {
                if (cell.intensity > 0.1) {
                    const screenX = x * tileSize - this.camera.x;
                    const screenY = y * tileSize - this.camera.y;
                    
                    // Skip rendering if off-screen
                    if (screenX < -tileSize || screenX > this.canvas.width || 
                        screenY < -tileSize || screenY > this.canvas.height) {
                        return;
                    }
                    
                    // Fire color based on intensity
                    const intensity = Math.min(1, cell.intensity);
                    const red = Math.floor(255 * intensity);
                    const green = Math.floor(100 * intensity);
                    const alpha = 0.3 + 0.7 * intensity;
                    
                    this.ctx.fillStyle = `rgba(${red}, ${green}, 0, ${alpha})`;
                    this.ctx.fillRect(screenX, screenY, tileSize, tileSize);
                    
                    // Add flickering effect
                    if (Math.random() < intensity * 0.3) {
                        this.ctx.fillStyle = `rgba(255, 150, 0, ${alpha * 0.5})`;
                        this.ctx.fillRect(screenX + Math.random() * 10 - 5, screenY + Math.random() * 10 - 5, 
                                        tileSize/2, tileSize/2);
                    }
                }
            });
        });
    }
    
    renderCivilians() {
        if (!this.gameState.civilians) return;
        
        this.gameState.civilians.forEach(civilian => {
            if (civilian.rescued) return;
            
            const screenX = civilian.x - this.camera.x;
            const screenY = civilian.y - this.camera.y;
            
            // Skip rendering if off-screen
            if (screenX < -20 || screenX > this.canvas.width || 
                screenY < -20 || screenY > this.canvas.height) {
                return;
            }
            
            // Civilian color based on health
            let color = '#44ff44'; // Healthy
            if (civilian.unconscious) {
                color = '#ff4444'; // Unconscious
            } else if (civilian.health < 50) {
                color = '#ffff44'; // Injured
            }
            
            this.ctx.fillStyle = color;
            this.ctx.beginPath();
            this.ctx.arc(screenX, screenY, 8, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Health indicator
            if (!civilian.unconscious) {
                this.ctx.fillStyle = '#000';
                this.ctx.fillRect(screenX - 10, screenY - 15, 20, 4);
                this.ctx.fillStyle = color;
                this.ctx.fillRect(screenX - 10, screenY - 15, 20 * (civilian.health / 100), 4);
            }
            
            // Rescue indicator
            this.ctx.fillStyle = 'white';
            this.ctx.font = '10px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText('!', screenX, screenY - 20);
        });
    }
    
    renderPlayers() {
        if (!this.gameState.players) return;
        
        const roleColors = {
            axe: '#ff8844',
            extinguisher: '#4488ff',
            medic: '#44ff44',
            engineer: '#ffff44'
        };
        
        this.gameState.players.forEach(player => {
            const screenX = player.x - this.camera.x;
            const screenY = player.y - this.camera.y;
            
            // Skip rendering if off-screen
            if (screenX < -20 || screenX > this.canvas.width || 
                screenY < -20 || screenY > this.canvas.height) {
                return;
            }
            
            // Player body
            this.ctx.fillStyle = roleColors[player.role] || '#ffffff';
            this.ctx.beginPath();
            this.ctx.arc(screenX, screenY, 12, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Player outline
            this.ctx.strokeStyle = player.id === this.playerId ? '#ffffff' : '#888888';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            
            // Health bar
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(screenX - 15, screenY - 20, 30, 4);
            this.ctx.fillStyle = '#ff4444';
            this.ctx.fillRect(screenX - 15, screenY - 20, 30 * (player.health / 100), 4);
            
            // Water bar
            this.ctx.fillStyle = '#000';
            this.ctx.fillRect(screenX - 15, screenY + 18, 30, 4);
            this.ctx.fillStyle = '#4444ff';
            this.ctx.fillRect(screenX - 15, screenY + 18, 30 * (player.water / 100), 4);
            
            // Role indicator
            this.ctx.fillStyle = 'white';
            this.ctx.font = '8px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(player.role[0].toUpperCase(), screenX, screenY + 4);
        });
    }
    
    renderWaterSprayEffects() {
        this.waterSprayEffects.forEach(effect => {
            const alpha = effect.lifetime / effect.maxLifetime;
            const screenStartX = effect.startX - this.camera.x;
            const screenStartY = effect.startY - this.camera.y;
            const screenEndX = effect.endX - this.camera.x;
            const screenEndY = effect.endY - this.camera.y;
            
            this.ctx.strokeStyle = `rgba(100, 150, 255, ${alpha * 0.8})`;
            this.ctx.lineWidth = 6;
            this.ctx.beginPath();
            this.ctx.moveTo(screenStartX, screenStartY);
            this.ctx.lineTo(screenEndX, screenEndY);
            this.ctx.stroke();
            
            // Water droplets
            for (let i = 0; i < 5; i++) {
                const t = i / 4;
                const x = screenStartX + (screenEndX - screenStartX) * t + (Math.random() - 0.5) * 20;
                const y = screenStartY + (screenEndY - screenStartY) * t + (Math.random() - 0.5) * 20;
                
                this.ctx.fillStyle = `rgba(150, 200, 255, ${alpha * 0.6})`;
                this.ctx.beginPath();
                this.ctx.arc(x, y, 2, 0, Math.PI * 2);
                this.ctx.fill();
            }
        });
    }
    
    updateUI() {
        if (!this.gameState) return;
        
        // Game status
        document.getElementById('currentGameId').textContent = this.gameId || '-';
        document.getElementById('playerCount').textContent = this.gameState.players ? this.gameState.players.length : 0;
        document.getElementById('gameStatus').textContent = this.gameState.state;
        
        // Timer
        if (this.gameState.timeRemaining !== undefined) {
            const minutes = Math.floor(this.gameState.timeRemaining / 60);
            const seconds = Math.floor(this.gameState.timeRemaining % 60);
            document.getElementById('timeRemaining').textContent = 
                `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
        
        // Player info
        if (this.playerId && this.gameState.players) {
            const player = this.gameState.players.find(p => p.id === this.playerId);
            if (player) {
                document.getElementById('playerRole').textContent = player.role;
                
                // Health bar
                const healthPercent = (player.health / 100) * 100;
                document.getElementById('healthBar').style.width = healthPercent + '%';
                document.getElementById('healthText').textContent = `${Math.floor(player.health)}/100`;
                
                // Water bar
                const waterPercent = (player.water / 100) * 100;
                document.getElementById('waterBar').style.width = waterPercent + '%';
                document.getElementById('waterText').textContent = `${Math.floor(player.water)}/100`;
            }
        }
        
        // Structure integrity
        if (this.gameState.structuralIntegrity !== undefined) {
            const structurePercent = (this.gameState.structuralIntegrity / 100) * 100;
            document.getElementById('structureBar').style.width = structurePercent + '%';
            document.getElementById('structureText').textContent = 
                `${Math.floor(this.gameState.structuralIntegrity)}/100`;
        }
        
        // Civilians
        if (this.gameState.civilians) {
            const rescued = this.gameState.civilians.filter(c => c.rescued).length;
            document.getElementById('civilianCount').textContent = rescued;
        }
    }
    
    showGameEndModal(result, stats) {
        const modal = document.getElementById('gameEndModal');
        const title = document.getElementById('gameEndTitle');
        const content = document.getElementById('gameEndContent');
        const statsDiv = document.getElementById('gameEndStats');
        
        title.textContent = result === 'victory' ? 'VICTORY!' : 'MISSION FAILED';
        content.className = result === 'victory' ? 'victory' : 'defeat';
        
        statsDiv.innerHTML = `
            <div>Time Elapsed: ${Math.floor(stats.timeElapsed)}s</div>
            <div>Structure Integrity: ${Math.floor(stats.structuralIntegrity)}%</div>
            <div>Civilians Rescued: ${stats.civiliansRescued}/${stats.totalCivilians}</div>
            <div>Water Used: ${stats.waterUsed}L</div>
        `;
        
        modal.style.display = 'flex';
    }
}

// Global functions for HTML callbacks
function joinGame() {
    const playerName = document.getElementById('playerName').value.trim();
    const gameId = document.getElementById('gameId').value.trim();
    
    if (!playerName) {
        alert('Please enter your firefighter name');
        return;
    }
    
    game.socket.emit('joinGame', {
        playerName: playerName,
        gameId: gameId || null
    });
}

function returnToLobby() {
    location.reload();
}

// Start the game
let game;
document.addEventListener('DOMContentLoaded', () => {
    game = new Game();
}); 