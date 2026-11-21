# GLB → FBX

Herramienta web para convertir modelos 3D a **FBX**, **OBJ** o **GLB** y extraer sus **texturas**, pensada para usarlos en 3ds Max. Todo se procesa en el navegador: los archivos no se suben a ningún servidor.

## Entrada

- **GLB / glTF**: por ejemplo, las descargas de Sketchfab. El ZIP "glTF" de Sketchfab también funciona.
- **FBX, OBJ (+ MTL), DAE, STL, PLY**.
- Si las texturas vienen aparte, suéltalas junto al modelo o mete todo en un ZIP. Se encuentran por nombre de archivo, aunque el modelo tenga rutas absolutas como `C:\...\tex.png`.

## Salida

- **FBX**: mallas, normales, UVs y materiales, con los mapas ya conectados.
  - Diffuse
  - Normal
  - Bump
  - Emisivo
  - Specular
  - Opacidad: si el material tiene transparencia, se genera `*_opacity.png` a partir del canal alfa.
- **OBJ + MTL**: la misma información, en un formato simple y universal.
- **GLB**: un solo archivo. Es el único formato que conserva huesos y animaciones.
- **Texturas**: se extraen sin cambios. Opcionalmente se optimizan:
  - Tamaño en potencia de 2 con un máximo (por defecto 512 px), o un tamaño exacto.
  - Compresión con calidad alta: JPG para las texturas opacas y PNG sin pérdida para las que tienen transparencia.

## Limitaciones

- FBX y OBJ no llevan huesos ni animaciones: el modelo se exporta en su pose actual.
- Las unidades se asumen según el formato: glTF y DAE en metros, FBX y OBJ en centímetros, STL en milímetros. Si el tamaño no cuadra, usa "Escala del modelo".

## Publicar en GitHub Pages

1. Sube el contenido de esta carpeta a un repositorio.
2. Ve a **Settings → Pages → Deploy from a branch**, elige `main` y `/ (root)`.

## Probar en local

```
npx serve .
```
