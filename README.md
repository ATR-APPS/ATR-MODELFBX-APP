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

Cada push a `main` compila el proyecto y publica la web en GitHub Pages automáticamente.

## Contribuir

Las mejoras son bienvenidas.

1. Haz un fork del repositorio y crea una rama para tu cambio.
2. Instala las dependencias con `npm install` y prueba con `npm run dev`.
3. Comprueba que `npm run build` funciona.
4. Abre un pull request explicando qué cambia y por qué.

Para errores o ideas, abre un [issue](https://github.com/ATR-APPS/ATR-MODELFBX-APP/issues).

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

## Licencia

[MIT](LICENSE)
