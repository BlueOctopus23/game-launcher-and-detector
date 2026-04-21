# Game Launcher

## Inicio rapido

1. Doble click en GameLauncher Setup 1.0.0.exe
2. Seguir indicaciones
3. Abrir

## Deteccion de juegos

### Steam (automatico)
Al abrir la app por primera vez, detecta automaticamente librerias de Steam en rutas comunes en unidades C-G

Puedes anadir librerias manualmente con: Ajustes -> Detectar Steam

### Carpetas personalizadas
Usa "+ Carpeta" en la barra de herramientas.
El escaner filtra automaticamente instaladores, runtimes, anti-cheat y
otros ejecutables que NO son juegos, usando una lista negra + filtro de tamaño.

### Ejecutable individual
Usa "+ .exe" para anadir cualquier juego manualmente.

## Requisitos

- Windows 10/11 (64-bit)
- Node.js >= 18  ->  https://nodejs.org/

## Anadir icono personalizado

## Personalizar la UI

Edita las variables CSS en src\css\style.css:  
  --accent    color principal (cambiable tambien desde dentro de la app)  
  --bg        fondo  
  --card      tarjetas de juegos  
  --font-main tipografia principal  
