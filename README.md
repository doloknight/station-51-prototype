# Station 51 - Co-operative Firefighting Game Prototype

A frantic, top-down 2D co-operative action game where 2-4 players race against a living, spreading fire inside procedurally arranged buildings. Work together to manage limited water, rescue civilians, and contain the blaze before the structure collapses.

## Features Implemented

### Core Gameplay
- **Real-time multiplayer** (2-4 players)
- **Dynamic fire simulation** with cellular automata-style spreading
- **Water pressure system** with limited supply
- **Civilian rescue mechanics** with health degradation from smoke
- **Structural integrity timer** that decreases as fire spreads
- **Role-based gameplay** (Axe, Extinguisher, Medic, Engineer)

### Technical Features
- **WebSocket-based networking** with Socket.io
- **Canvas-based rendering** with smooth animations
- **Real-time fire effects** with flickering flames
- **Water spray visual effects**
- **Responsive UI** with health/water/structure bars
- **Procedural level generation**

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Local Development

1. **Clone/Download the project files**
   ```bash
   # Navigate to the project directory
   cd station-51-prototype
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   # or for development with auto-restart:
   npm run dev
   ```

4. **Open the game**
   - Open your browser and go to `http://localhost:3000`
   - Enter your firefighter name and click "Join Game"
   - Share the Game ID with friends to play together

## How to Play

### Controls
- **WASD** - Move your firefighter
- **Mouse** - Aim water hose
- **Left Click** - Spray water to extinguish fires
- **Space** - Rescue nearby civilians
- **R** - Refill water at hydrants (feature in progress)

### Objective
1. **Contain the fire** - Use your water hose to extinguish flames before they spread
2. **Rescue civilians** - Find and rescue at least 70% of trapped civilians
3. **Beat the clock** - Complete objectives before structural integrity hits 0%

### Roles & Teamwork
Each player gets a different role with unique capabilities:
- **🔥 Axe** (Orange) - Fast breaching specialist
- **💨 Extinguisher** (Blue) - Instant fire suppression
- **❤️ Medic** (Green) - Heal smoke damage & faster civilian rescue
- **⚙️ Engineer** (Yellow) - Deploy fans & repair hydrants

### Win Conditions
- **Victory**: Fire intensity below 10% AND 70%+ civilians rescued
- **Defeat**: Structural integrity reaches 0% OR time runs out

## Game Mechanics

### Fire Simulation
- Fire spreads to adjacent cells based on temperature, fuel, and oxygen
- Different materials burn at different rates
- Water reduces temperature and intensity
- Fire consumes oxygen and fuel over time

### Water System
- Limited water supply shared between all players
- Water pressure decreases with distance from source
- Hydrants can refill water supply (when activated)

### Civilian AI
- NPCs take smoke damage over time in fire zones
- Unconscious civilians need immediate rescue
- Rescued civilians contribute to victory score

## Technical Architecture

### Server (Node.js + Socket.io)
- `Game` class manages game state and physics
- `FireSimulation` class handles cellular automata fire spreading
- Real-time multiplayer synchronization at 30 FPS
- Deterministic game state for all players

### Client (HTML5 Canvas + JavaScript)
- Canvas-based 2D rendering with camera system
- Real-time input handling and prediction
- Visual effects for fire, water, and UI elements
- Responsive design for different screen sizes

## Hosting Online

### Deploy to Render.com (Recommended)
1. Push code to GitHub repository
2. Connect Render to your GitHub repo
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Deploy and share the URL with players

### Deploy to Heroku
1. Install Heroku CLI
2. Create new Heroku app: `heroku create station-51-game`
3. Deploy: `git push heroku main`
4. Open: `heroku open`

### Environment Variables
- `PORT` - Server port (default: 3000)

## Development Roadmap

### Completed ✅
- [x] Basic multiplayer networking
- [x] Fire simulation system
- [x] Player movement and roles
- [x] Water spraying mechanics
- [x] Civilian rescue system
- [x] Win/lose conditions
- [x] UI and visual effects

### Next Steps 🚧
- [ ] Hydrant refill mechanics
- [ ] Advanced role-specific abilities
- [ ] Sound effects and audio
- [ ] More complex level layouts
- [ ] Power-ups and equipment upgrades
- [ ] Spectator mode
- [ ] Mobile touch controls

## Contributing

This is a prototype implementation based on the Station 51 design document. Key areas for expansion:

1. **Enhanced Fire Physics** - Add backdrafts, flashovers, smoke mechanics
2. **Advanced AI** - Smarter civilian behavior and pathfinding  
3. **Level Design** - Hand-crafted scenarios and objectives
4. **Audio System** - Positional audio for immersion
5. **Performance** - Optimize for larger maps and more players

## License

This prototype is for demonstration purposes. See design document for full game concept details.

---

**Ready to fight some fires? Get your crew together and save the day! 🚒🔥** 