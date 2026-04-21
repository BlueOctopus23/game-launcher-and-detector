; custom.nsh
; Script NSIS personalizado que electron-builder incluye en el instalador.
; Añade una página de detalle de archivos antes de instalar.

; ── Página extra: detalle de lo que se instala ─────────────────────────────
!macro customHeader
  !system "echo Compilando con pagina de detalles..."
!macroend

!macro customInstall
  ; Mostrar en la barra de estado cada componente copiado
  DetailPrint "Copiando aplicacion Electron (GameLauncher.exe)..."
  DetailPrint "Copiando recursos de la interfaz (HTML / CSS / JS)..."
  DetailPrint "Copiando base de datos SQLite (sql.js / WebAssembly)..."
  DetailPrint "Copiando librerias de Node.js (node_modules)..."
  DetailPrint "Creando acceso directo en el Escritorio..."
  DetailPrint "Creando acceso directo en el Menu Inicio..."
  DetailPrint "Registrando en Agregar o Quitar programas..."
  DetailPrint ""
  DetailPrint "Instalacion completada."
!macroend

!macro customUnInstall
  DetailPrint "Eliminando archivos de Game Launcher..."
  DetailPrint "Eliminando accesos directos..."
  DetailPrint "Eliminando entradas de registro..."
!macroend

; ── Textos personalizados del instalador ───────────────────────────────────
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE    "Bienvenido a Game Launcher"
  !define MUI_WELCOMEPAGE_TEXT     "Este asistente te guiará en la instalación de Game Launcher.$\r$\n$\r$\nPuedes elegir la carpeta de instalación en el siguiente paso.$\r$\n$\r$\nSe crearán accesos directos en el Escritorio y en el Menú Inicio."
!macroend
