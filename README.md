# ATR MODELFBX

Convert 3D models to **FBX**, **OBJ**, **GLB** or a Minecraft-style **Blockbench** model, extract their textures and optimize them. Everything runs in the browser; your files never leave your computer.

**Live app:** https://atr-apps.github.io/ATR-MODELFBX-APP/

## Features

- **Input:** GLB, glTF (including Sketchfab's ZIP download), FBX, OBJ + MTL, DAE, STL and PLY. Loose textures can be dropped next to the model or packed in a ZIP.
- **Output:** FBX with texture maps already connected to the materials, OBJ + MTL, or GLB.
- **Blockbench (.bbmodel):** turns the model into Minecraft-style cubes. It keeps only the outer shell, merges cubes greedily and paints a pixel-art texture (1 texel = 1 Blockbench unit) sampled from the original textures. Resolution and texture pixels per cube are adjustable.
- **Textures:** extracts the original image files, with optional optimization (power-of-two sizes with a maximum, or an exact size, plus high-quality compression).
- **Model:** removes duplicate vertices and reduces polygons while preserving UVs and materials.

## Development

```bash
npm install
npm run dev
```

## Deployment

Every push to `main` builds the project and publishes it to GitHub Pages automatically.

## Contributing

Contributions are welcome.

1. Fork the repository and create a branch for your change.
2. Install the dependencies with `npm install` and test with `npm run dev`.
3. Make sure `npm run build` succeeds.
4. Open a pull request describing what changes and why.

For bugs or ideas, open an [issue](https://github.com/ATR-APPS/ATR-MODELFBX-APP/issues).

## Project structure

```
src/
  main.js              UI and main flow
  files.js             file and ZIP reading
  utils.js
  model/               format loaders and mesh tools
  export/              FBX and OBJ writers, voxelizer and Blockbench writer
  textures/            image processing and optimization
  viewer/              3D viewer
  ui/                  UI components
  styles/
public/
  draco/               Draco decoder
```

## License

[MIT](LICENSE)
