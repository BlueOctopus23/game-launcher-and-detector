# Game Launcher  

## Quick Start  

1. Double-click **GameLauncher Setup 1.0.0.exe**  
2. Follow the installation steps  
3. Launch the app  

## Game Detection  

### Steam (Automatic)  
When you open the app for the first time, it automatically detects Steam libraries in common paths on drives C–G.  

You can also add libraries manually via: **Settings → Detect Steam**  

### Custom Folders  
Use **+ Folder** in the toolbar.  
The scanner automatically filters out installers, runtimes, anti-cheat systems, and other executables that are NOT games, using a blacklist + size filter.  

### Individual Executable  
Use **+ .exe** to manually add any game.  
  
## Requirements  

- Windows 10/11 (64-bit)  
- Node.js >= 18 → https://nodejs.org/  

## Add Custom Icon  

## Customize the UI  

Edit the CSS variables in src/css/style.css:  
- --accent    main color (can also be changed inside the app)  
- --bg        background  
- --card      game cards  
- --font-main main typography  
