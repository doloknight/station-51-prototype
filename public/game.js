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
        this.socket.on('lobbyJoined', (data) => {
            console.log('Joined lobby:', data);
            this.gameId = data.gameId;
            this.playerId = data.playerId;
            this.lobbyState = data.lobbyState;
            
            document.getElementById('joinForm').style.display = 'none';
            document.getElementById('lobby').style.display = 'block';
            
            this.updateLobby();
        });

        this.socket.on('lobbyUpdated', (lobbyState) => {
            this.lobbyState = lobbyState;
            this.updateLobby();
        });

        this.socket.on('gameJoined', (data) => {
            console.log('Joined game:', data);
            this.gameId = data.gameId;
            this.playerId = data.playerId;
            this.gameState = data.gameState;
            
            document.getElementById('lobby').style.display = 'none';
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
            
            if (e.code === 'KeyH') {
                this.toggleHoseConnection();
            }
            
            if (e.code === 'KeyE') {
                this.extendHose();
            }
            
            if (e.code === 'KeyQ') {
                this.retractHose();
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
        
        // Limit update frequency for better performance
        if (deltaTime < 1/30) return; // Max 30 FPS updates
        
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
            
            const deltaTime = 1/60; // Assume 60 FPS
            const newX = player.x + dx * speed * deltaTime;
            const newY = player.y + dy * speed * deltaTime;
            
            // Check collisions and hose constraints
            const validPosition = this.checkCollisions(player, newX, newY);
            
            if (validPosition.x !== player.x || validPosition.y !== player.y) {
                this.socket.emit('playerMove', { 
                    x: validPosition.x, 
                    y: validPosition.y,
                    hoseStrained: validPosition.hoseStrained 
                });
            }
        }
    }
    
    checkCollisions(player, newX, newY) {
        const playerRadius = 8;
        let finalX = newX;
        let finalY = newY;
        let hoseStrained = false;
        
        // World bounds checking
        finalX = Math.max(playerRadius, Math.min(800 - playerRadius, finalX));
        finalY = Math.max(playerRadius, Math.min(600 - playerRadius, finalY));
        
        // Level collision detection
        if (this.gameState.level) {
            const tileSize = 20;
            const leftTile = Math.floor((finalX - playerRadius) / tileSize);
            const rightTile = Math.floor((finalX + playerRadius) / tileSize);
            const topTile = Math.floor((finalY - playerRadius) / tileSize);
            const bottomTile = Math.floor((finalY + playerRadius) / tileSize);
            
            for (let y = topTile; y <= bottomTile; y++) {
                for (let x = leftTile; x <= rightTile; x++) {
                    if (this.gameState.level.tiles[y] && this.gameState.level.tiles[y][x]) {
                        const tile = this.gameState.level.tiles[y][x];
                        if (!tile.passable) {
                            // Wall collision - push player back
                            const tileLeft = x * tileSize;
                            const tileRight = (x + 1) * tileSize;
                            const tileTop = y * tileSize;
                            const tileBottom = (y + 1) * tileSize;
                            
                            if (finalX + playerRadius > tileLeft && finalX - playerRadius < tileRight &&
                                finalY + playerRadius > tileTop && finalY - playerRadius < tileBottom) {
                                // Simple collision resolution - push back to previous position
                                finalX = player.x;
                                finalY = player.y;
                            }
                        }
                    }
                }
            }
        }
        
        // Hose constraint checking
        if (player.hose && player.hose.connected) {
            const hoseConstraint = this.checkHoseConstraints(player, finalX, finalY);
            finalX = hoseConstraint.x;
            finalY = hoseConstraint.y;
            hoseStrained = hoseConstraint.strained;
        }
        
        // Player-to-player collision
        if (this.gameState.players) {
            this.gameState.players.forEach(otherPlayer => {
                if (otherPlayer.id !== player.id) {
                    const distance = Math.sqrt(
                        Math.pow(finalX - otherPlayer.x, 2) + 
                        Math.pow(finalY - otherPlayer.y, 2)
                    );
                    if (distance < playerRadius * 2) {
                        // Simple separation
                        const angle = Math.atan2(finalY - otherPlayer.y, finalX - otherPlayer.x);
                        finalX = otherPlayer.x + Math.cos(angle) * playerRadius * 2;
                        finalY = otherPlayer.y + Math.sin(angle) * playerRadius * 2;
                    }
                }
            });
        }
        
        return { x: finalX, y: finalY, hoseStrained };
    }
    
    checkHoseConstraints(player, newX, newY) {
        if (!player.hose || !player.hose.connected) {
            return { x: newX, y: newY, strained: false };
        }
        
        const hose = player.hose;
        const connectionPoint = hose.connectionPoint;
        
        // Calculate total hose length used
        let totalLength = 0;
        let currentX = connectionPoint.x;
        let currentY = connectionPoint.y;
        
        // Add length of deployed hose segments
        for (let i = 0; i < hose.segments.length; i++) {
            const segment = hose.segments[i];
            const segmentLength = Math.sqrt(
                Math.pow(segment.x - currentX, 2) + 
                Math.pow(segment.y - currentY, 2)
            );
            totalLength += segmentLength;
            currentX = segment.x;
            currentY = segment.y;
        }
        
        // Add length from last segment to player position
        const remainingLength = Math.sqrt(
            Math.pow(newX - currentX, 2) + 
            Math.pow(newY - currentY, 2)
        );
        
        const totalRequiredLength = totalLength + remainingLength;
        
        if (totalRequiredLength > hose.maxLength) {
            // Constrain player to maximum hose reach
            const maxRemainingLength = hose.maxLength - totalLength;
            if (maxRemainingLength <= 0) {
                return { x: player.x, y: player.y, strained: true };
            }
            
            const angle = Math.atan2(newY - currentY, newX - currentX);
            const constrainedX = currentX + Math.cos(angle) * maxRemainingLength;
            const constrainedY = currentY + Math.sin(angle) * maxRemainingLength;
            
            return { x: constrainedX, y: constrainedY, strained: true };
        }
        
        return { x: newX, y: newY, strained: false };
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
        
        // Check if near hydrant or fire truck
        const refillDistance = 40;
        let canRefill = false;
        
        // Check hydrant
        if (this.gameState.hydrant) {
            const distance = Math.sqrt(
                Math.pow(player.x - this.gameState.hydrant.x, 2) + 
                Math.pow(player.y - this.gameState.hydrant.y, 2)
            );
            if (distance < refillDistance) {
                canRefill = true;
            }
        }
        
        // Check fire truck
        if (this.gameState.fireTruck) {
            const distance = Math.sqrt(
                Math.pow(player.x - this.gameState.fireTruck.x, 2) + 
                Math.pow(player.y - this.gameState.fireTruck.y, 2)
            );
            if (distance < refillDistance) {
                canRefill = true;
            }
        }
        
        if (canRefill) {
            this.socket.emit('refillWater', { playerId: this.playerId });
        }
    }
    
    toggleHoseConnection() {
        if (!this.gameState || !this.playerId) return;
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player) return;
        
        this.socket.emit('toggleHoseConnection', { playerId: this.playerId });
    }
    
    extendHose() {
        if (!this.gameState || !this.playerId) return;
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player || !player.hose || !player.hose.connected) return;
        
        this.socket.emit('extendHose', { 
            playerId: this.playerId,
            x: player.x,
            y: player.y
        });
    }
    
    retractHose() {
        if (!this.gameState || !this.playerId) return;
        
        const player = this.gameState.players.find(p => p.id === this.playerId);
        if (!player || !player.hose || !player.hose.connected) return;
        
        this.socket.emit('retractHose', { playerId: this.playerId });
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
            this.renderFireTruck();
            this.renderHydrant();
            this.renderHoses();
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
                }
            }
        }
    }
    
    renderFireTruck() {
        if (!this.gameState.fireTruck) return;
        
        const truck = this.gameState.fireTruck;
        const screenX = truck.x - this.camera.x;
        const screenY = truck.y - this.camera.y;
        
        // Fire truck body (PL 511)
        this.ctx.fillStyle = '#cc0000';
        this.ctx.fillRect(screenX - 40, screenY - 20, 80, 40);
        
        // Truck details
        this.ctx.fillStyle = '#990000';
        this.ctx.fillRect(screenX - 35, screenY - 15, 70, 30);
        
        // Cab
        this.ctx.fillStyle = '#cc0000';
        this.ctx.fillRect(screenX - 40, screenY - 20, 25, 40);
        
        // Water tank
        this.ctx.fillStyle = '#888';
        this.ctx.fillRect(screenX - 10, screenY - 15, 45, 30);
        
        // Pump controls
        this.ctx.fillStyle = '#ffff00';
        this.ctx.fillRect(screenX + 20, screenY - 5, 10, 10);
        
        // Text label
        this.ctx.fillStyle = 'white';
        this.ctx.font = '12px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('PL 511', screenX, screenY - 25);
        
        // Water level indicator
        const waterPercent = truck.waterLevel / truck.maxWater;
        this.ctx.fillStyle = waterPercent > 0.3 ? '#4444ff' : '#ff4444';
        this.ctx.fillRect(screenX - 8, screenY - 13, 41 * waterPercent, 26);
        
        // Hose connections
        truck.hoseConnections.forEach((connection, index) => {
            const connX = screenX + 30 + (index * 8);
            const connY = screenY + 18;
            
            this.ctx.fillStyle = connection.occupied ? '#00ff00' : '#666';
            this.ctx.fillRect(connX, connY, 6, 6);
        });
    }
    
    renderHydrant() {
        if (!this.gameState.hydrant) return;
        
        const hydrant = this.gameState.hydrant;
        const screenX = hydrant.x - this.camera.x;
        const screenY = hydrant.y - this.camera.y;
        
        // Hydrant base
        this.ctx.fillStyle = '#666';
        this.ctx.fillRect(screenX - 8, screenY - 8, 16, 16);
        
        // Hydrant body
        this.ctx.fillStyle = '#ff4444';
        this.ctx.fillRect(screenX - 6, screenY - 12, 12, 20);
        
        // Hydrant cap
        this.ctx.fillStyle = '#ffff00';
        this.ctx.fillRect(screenX - 4, screenY - 14, 8, 4);
        
        // Connection ports
        this.ctx.fillStyle = hydrant.connected ? '#00ff00' : '#666';
        this.ctx.fillRect(screenX - 8, screenY - 2, 4, 4);
        this.ctx.fillRect(screenX + 4, screenY - 2, 4, 4);
    }
    
    renderHoses() {
        if (!this.gameState.players) return;
        
        this.gameState.players.forEach(player => {
            if (player.hose && player.hose.connected) {
                this.renderPlayerHose(player);
            }
        });
    }
    
    renderPlayerHose(player) {
        const hose = player.hose;
        const connectionPoint = hose.connectionPoint;
        
        // Draw hose segments
        this.ctx.strokeStyle = hose.strained ? '#ff4444' : '#333';
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = 'round';
        
        this.ctx.beginPath();
        
        let currentX = connectionPoint.x - this.camera.x;
        let currentY = connectionPoint.y - this.camera.y;
        
        this.ctx.moveTo(currentX, currentY);
        
        // Draw through all segments
        hose.segments.forEach(segment => {
            const segX = segment.x - this.camera.x;
            const segY = segment.y - this.camera.y;
            this.ctx.lineTo(segX, segY);
            currentX = segX;
            currentY = segY;
        });
        
        // Draw to player position
        const playerX = player.x - this.camera.x;
        const playerY = player.y - this.camera.y;
        this.ctx.lineTo(playerX, playerY);
        
        this.ctx.stroke();
        
        // Draw segment markers
        this.ctx.fillStyle = '#666';
        hose.segments.forEach(segment => {
            const segX = segment.x - this.camera.x;
            const segY = segment.y - this.camera.y;
            this.ctx.fillRect(segX - 2, segY - 2, 4, 4);
        });
        
        // Draw connection point
        this.ctx.fillStyle = '#ffff00';
        this.ctx.fillRect(currentX - 3, currentY - 3, 6, 6);
        
        // Show hose length indicator
        const totalLength = this.calculateHoseLength(hose);
        const lengthPercent = totalLength / hose.maxLength;
        const color = lengthPercent > 0.9 ? '#ff4444' : lengthPercent > 0.7 ? '#ffff00' : '#00ff00';
        
        this.ctx.fillStyle = color;
        this.ctx.font = '10px monospace';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`${Math.round(totalLength)}/${hose.maxLength}ft`, playerX + 10, playerY - 10);
    }
    
    calculateHoseLength(hose) {
        let totalLength = 0;
        let currentX = hose.connectionPoint.x;
        let currentY = hose.connectionPoint.y;
        
        hose.segments.forEach(segment => {
            const segmentLength = Math.sqrt(
                Math.pow(segment.x - currentX, 2) + 
                Math.pow(segment.y - currentY, 2)
            );
            totalLength += segmentLength / 4; // Convert pixels to feet (rough conversion)
            currentX = segment.x;
            currentY = segment.y;
        });
        
        return totalLength;
    }
    
    renderFire() {
        if (!this.gameState.fire) return;
        
        const tileSize = 20;
        
        // Performance optimization: only render visible fire cells
        const startX = Math.max(0, Math.floor(this.camera.x / tileSize) - 1);
        const endX = Math.min(this.gameState.fire[0].length - 1, Math.floor((this.camera.x + this.canvas.width) / tileSize) + 1);
        const startY = Math.max(0, Math.floor(this.camera.y / tileSize) - 1);
        const endY = Math.min(this.gameState.fire.length - 1, Math.floor((this.camera.y + this.canvas.height) / tileSize) + 1);
        
        for (let y = startY; y <= endY; y++) {
            for (let x = startX; x <= endX; x++) {
                const cell = this.gameState.fire[y][x];
                if (cell.intensity > 0.1) {
                    const screenX = x * tileSize - this.camera.x;
                    const screenY = y * tileSize - this.camera.y;
                    
                    // Simplified fire rendering for performance
                    const intensity = Math.min(1, cell.intensity);
                    const red = Math.floor(255 * intensity);
                    const green = Math.floor(80 * intensity);
                    const alpha = 0.4 + 0.6 * intensity;
                    
                    this.ctx.fillStyle = `rgba(${red}, ${green}, 0, ${alpha})`;
                    this.ctx.fillRect(screenX, screenY, tileSize, tileSize);
                    
                    // Reduced flickering effect for performance
                    if (intensity > 0.5 && (x + y + Math.floor(Date.now() / 200)) % 4 === 0) {
                        this.ctx.fillStyle = `rgba(255, 120, 0, ${alpha * 0.4})`;
                        this.ctx.fillRect(screenX + 2, screenY + 2, tileSize - 4, tileSize - 4);
                    }
                }
            }
        }
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
        // Limit to maximum 10 effects for performance
        const maxEffects = 10;
        const effects = this.waterSprayEffects.slice(-maxEffects);
        
        effects.forEach(effect => {
            const alpha = effect.lifetime / effect.maxLifetime;
            const screenStartX = effect.startX - this.camera.x;
            const screenStartY = effect.startY - this.camera.y;
            const screenEndX = effect.endX - this.camera.x;
            const screenEndY = effect.endY - this.camera.y;
            
            // Only render if on screen
            if (screenStartX > -50 && screenStartX < this.canvas.width + 50 && 
                screenStartY > -50 && screenStartY < this.canvas.height + 50) {
                
                this.ctx.strokeStyle = `rgba(100, 150, 255, ${alpha * 0.7})`;
                this.ctx.lineWidth = 4;
                this.ctx.beginPath();
                this.ctx.moveTo(screenStartX, screenStartY);
                this.ctx.lineTo(screenEndX, screenEndY);
                this.ctx.stroke();
                
                // Simplified water droplets for performance
                if (alpha > 0.5) {
                    this.ctx.fillStyle = `rgba(150, 200, 255, ${alpha * 0.5})`;
                    this.ctx.fillRect(screenEndX - 3, screenEndY - 3, 6, 6);
                }
            }
        });
    }
    
    updateLobby() {
        if (!this.lobbyState) return;
        
        document.getElementById('lobbyGameId').textContent = this.gameId || '-';
        
        // Update role slots
        const roles = ['pump-operator', 'section-commander', 'firefighter'];
        const roleLimits = { 'pump-operator': 1, 'section-commander': 1, 'firefighter': 2 };
        
        roles.forEach(role => {
            const roleSlot = document.querySelector(`[data-role="${role}"]`);
            const players = this.lobbyState.players.filter(p => p.role === role);
            const limit = roleLimits[role];
            
            // Update count
            const countSpan = roleSlot.querySelector('.role-count');
            countSpan.textContent = `${players.length}/${limit}`;
            
            // Update players list
            const playersDiv = roleSlot.querySelector('.role-players');
            playersDiv.innerHTML = '';
            players.forEach(player => {
                const playerSpan = document.createElement('span');
                playerSpan.className = 'role-player' + (player.id === this.playerId ? ' you' : '');
                playerSpan.textContent = player.name || `Player ${player.id.substr(0, 4)}`;
                playersDiv.appendChild(playerSpan);
            });
            
            // Update button and styling
            const button = roleSlot.querySelector('.role-btn');
            const currentPlayer = this.lobbyState.players.find(p => p.id === this.playerId);
            
            if (players.length >= limit) {
                roleSlot.className = 'role-slot full';
                button.disabled = true;
                button.textContent = 'Role Full';
            } else if (currentPlayer && currentPlayer.role === role) {
                roleSlot.className = 'role-slot selected';
                button.disabled = false;
                button.textContent = 'Selected';
            } else if (currentPlayer && currentPlayer.role && currentPlayer.role !== role) {
                roleSlot.className = 'role-slot';
                button.disabled = false;
                button.textContent = 'Switch Role';
            } else {
                roleSlot.className = 'role-slot available';
                button.disabled = false;
                button.textContent = 'Select Role';
            }
        });
        
        // Update start button
        const startBtn = document.getElementById('startGameBtn');
        const totalPlayers = this.lobbyState.players.length;
        const allRolesFilled = this.lobbyState.players.filter(p => p.role === 'pump-operator').length === 1 &&
                              this.lobbyState.players.filter(p => p.role === 'section-commander').length === 1 &&
                              this.lobbyState.players.filter(p => p.role === 'firefighter').length === 2;
        
        if (totalPlayers === 4 && allRolesFilled) {
            startBtn.disabled = false;
            startBtn.textContent = 'Start Mission';
        } else {
            startBtn.disabled = true;
            startBtn.textContent = `Waiting for players (${totalPlayers}/4)`;
        }
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
function joinLobby() {
    const playerName = document.getElementById('playerName').value.trim();
    const gameId = document.getElementById('gameId').value.trim();
    
    if (!playerName) {
        alert('Please enter your firefighter name');
        return;
    }
    
    game.socket.emit('joinLobby', {
        playerName: playerName,
        gameId: gameId || null
    });
}

function selectRole(role) {
    game.socket.emit('selectRole', { role: role });
}

function startGame() {
    game.socket.emit('startGame');
}

function leaveLobby() {
    game.socket.emit('leaveLobby');
    location.reload();
}

function returnToLobby() {
    location.reload();
}

// Start the game
let game;
document.addEventListener('DOMContentLoaded', () => {
    game = new Game();
}); 