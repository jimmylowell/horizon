# Lidar bake

Bakes one town's USGS lidar into the 1 m height tiles the page marches
(docs/design.md, *Lidar in town*). Towns are in `towns.json`; Salida is the
only one.

```sh
mkdir -p ../hz-lidar/node && npm install --no-save --prefix ../hz-lidar/node laz-perf@0.0.7 geotiff proj4 pngjs
node scripts/lidar/fetch.mjs salida ../hz-lidar          # ground model + catalog (~220 MB)
(cd ../hz-lidar/node && node "$OLDPWD/scripts/lidar/bake.mjs" salida ../ ../out)   # ~2 min, reads the points from AWS
```

`out/salida/` then holds six PNGs and `index.json` (point classes, the
points' GPS-time span, the ground check). For a build, copy the folder to
`public/lidar/salida/`; it is not committed. To serve the tiles from R2
instead, upload the folder and build with `VITE_LIDAR_BASE=https://…/`.
