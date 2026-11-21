# ATR MODELFBX

Convierte modelos 3D a **FBX**, **OBJ** o **GLB**, extrae sus texturas y optimízalos. Todo se procesa en el navegador; los archivos no salen de tu equipo.

**Web:** https://atr-apps.github.io/ATR-MODELFBX-APP/

## Funciones

- **Entrada:** GLB, glTF (también el ZIP de Sketchfab), FBX, OBJ + MTL, DAE, STL y PLY. Las texturas sueltas pueden ir junto al modelo o dentro de un ZIP.
- **Salida:** FBX con los mapas conectados al material, OBJ + MTL, o GLB.
- **Texturas:** extracción de los archivos originales y optimización opcional (potencia de 2 con tamaño máximo, o tamaño exacto, con compresión de alta calidad).
- **Modelo:** limpieza de vértices duplicados y reducción de polígonos que conserva UVs y materiales.

## Desarrollo

```bash
npm install
npm run dev
```

## Publicación

```bash
npm run deploy
```

Compila el proyecto y publica `dist/` en [ATR-MODELFBX-APP](https://github.com/ATR-APPS/ATR-MODELFBX-APP), que sirve la web con GitHub Pages.

## Estructura

```
src/
  main.js              interfaz y flujo principal
  files.js             lectura de archivos y ZIP
  utils.js
  model/               carga de formatos y herramientas de malla
  export/              escritores FBX y OBJ
  textures/            procesamiento y optimización de imágenes
  viewer/              visor 3D
  ui/                  componentes de interfaz
  styles/
public/
  draco/               decodificador Draco
```
