# B08 Web - 3D Model Viewer & Analysis

A complete, modern 3D Model Viewer & Analysis Web Application (B08).

---

1. **3D Viewport & Rendering**:
   - High-fidelity WebGL rendering powered by Three.js with PBR material shading, soft directional shadows, and physically-correct lighting.
   - Ground grid and contact shadow receiver plane.
   - Smooth turntable auto-rotation (ground-grid aligned).
   - Perspective and Orthographic projection toggle.
   - Preset camera views: Front, Back, Left, Right, Top, Bottom, and Isometric.
   - **Studio Light & Background Presets**: Default **Studio Light** mode (pure pitch-black background with a focused overhead top studio light and dramatic floor shadow falloff), along with Navy, Black, White, and **Custom Environment & Background Image** (upload JPG, PNG, WebP for 360° Equirectangular studio world or 2D backdrop).

2. **Render & Shading Modes**:
   - **Solid Shaded**: PBR smooth surface with adjustable roughness and metalness.
   - **Flat Shaded**: Low-poly / faceted polygon representation.
   - **Wireframe Overlay**: Edge topology lines overlaid on the solid model.
   - **Wireframe Only**: Pure mesh wireframe.
   - **Points Cloud**: Vertex point cloud visualization.
   - **Surface Normals**: Colored surface normal vectors for debugging orientation.
   - **X-Ray / Glass**: Semi-transparent internal cavity visualization.

3. **Format Support**:
   - **STL** (Binary & ASCII) - Includes the bundled **Stanford Bunny** sample (`Stanford_Bunny_sample.stl`).
   - **OBJ & MTL** (Wavefront with materials and textures).
   - **GLTF & GLB** (Embedded & binary glTF).
   - **PLY** (Polygon File Format).
   - **3MF** (3D Manufacturing Format).
   - **FBX** (Filmbox 3D).

4. **Model Analysis & 3D Printing Metrics**:
   - **Bounding Dimensions**: Width (X), Height (Y), Depth (Z) with multi-unit support (`mm`, `cm`, `inches`).
   - **Mesh Topology**: Accurate Triangle and Vertex counts.
   - **Surface Area**: Exact surface area calculation ($cm^2$ / $mm^2$).
   - **Volume**: Divergence-based 3D mesh volume ($cm^3$ / $mm^3$).
   - **Watertight / Manifold Check**: Validates whether the mesh is a closed 2-manifold suitable for 3D printing.
   - **Material Weight Estimator**: Calculates mass based on selectable material densities (PLA, ABS, PETG, TPU, Resin, Nylon, Aluminum, Steel, etc.) and infill percentage slider (0% to 100%).

5. **Transform & Alignment (Ground to Face)**:
   - **Ground to Selected Face**: Click the tool button (or press `G`), hover over any face to see the glowing highlight and normal vector, then click any face to smoothly orient that face flat against the ground bed ($Y_{min}=0$) and center the model in $X$ and $Z$.
   - **Rotate 90°**: Rotate model 90° around Y-axis.

6. **Video Turntable Recorder & Framing Guides**:
   - **Aspect Ratio Frame Guides**: Toggle on-screen framing overlay (Shortcut: `F`) with preset aspect ratios:
     - `1:1` Square (Instagram / E-Commerce)
     - `16:9` Landscape (YouTube / Desktop / Presentations)
     - `9:16` Vertical (TikTok / Reels / Shorts)
     - `4:3` Standard presentation format
     - `Full Viewport`
   - **Auto-Fit Model to Frame**: Calculates camera distance and framing bounding box so the 3D model remains cleanly in-frame without clipping during full rotation.
   - **Turntable Video Recording**:
     - Max duration capped at 10.0 seconds (customizable from 1.0s to 10.0s).
     - **Synchronized 360° Loop**: Automatically synchronizes turntable speed so the model completes exactly one full 360° rotation over the chosen recording duration around the ground grid vertical axis.
     - **High Resolution**: 1080p Full HD or 720p HD capture at smooth 60 FPS using HTML5 `MediaRecorder` + offscreen cropped canvas streaming.
     - Live on-screen recording HUD with elapsed timer and animated progress bar.
     - Automatic video file download (`.webm` / `.mp4`).
     - Shortcut `V` opens the Record Turntable Video dialog.

7. **Export & Capture**:
   - **Export as STL** (Binary).
   - **Export as OBJ**.
   - **Export as GLTF / GLB**.
   - **High-Res Snapshot** capture to PNG.

8. **Drag & Drop & Touch Support**:
   - Fullscreen drag & drop for any 3D model.
   - Mobile and tablet touch support (1 finger to rotate, 2 fingers to pinch-zoom and pan).

---

## 🏃 Quick Start

### Method 1: Double-Click Launcher (Windows)
Double-click `Launch_B08.bat`. It starts the local server and automatically opens the app in your browser at `http://localhost:3000`.

### Method 2: npm / Node.js
```bash
# Start local server with pre-built production files
npm start

# Or start the Vite development server with live reload
npm run dev
```

### Method 3: Build for Production Deployment
```bash
npm run build
```
The compiled, production-ready static assets are in the `dist/` directory, ready to be hosted on Vercel, Netlify, Cloudflare Pages, GitHub Pages, or any standard web server.

---

## 🌐 Deploy to GitHub Pages (100% Serverless)

Because B08 is a pure static client-side web application with zero backend server dependencies, it runs directly on **GitHub Pages**:

### Option A: Automatic via GitHub Actions (Recommended)
1. Push this repository to GitHub.
2. In your repository on GitHub, go to **Settings** > **Pages**.
3. Under **Build and deployment** > **Source**, choose **GitHub Actions**.
4. The included `.github/workflows/deploy.yml` will automatically build and publish the app!

### Option B: Deploy `dist/` Folder Directly
1. Run `npm run build`.
2. Push the contents of the `dist/` folder to a `gh-pages` branch, or configure GitHub Pages to serve from the `/dist` or `/docs` folder in your repository settings.
