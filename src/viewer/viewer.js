import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const wireMaterial = new THREE.MeshBasicMaterial({
  color: 0x6a6a6a,
  wireframe: true,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    for (const material of [].concat(child.material || [])) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}

export function meshesToGroup(meshes, materials, scale) {
  const group = new THREE.Group();
  const fallback = new THREE.MeshStandardMaterial({ color: 0xbbbbbb });
  const palette = materials.map((m) => m || fallback);
  const inverse = 1 / scale;

  for (const mesh of meshes) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(mesh.positions.length);
    for (let i = 0; i < positions.length; i++) positions[i] = mesh.positions[i] * inverse;

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (mesh.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    if (mesh.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

    const ids = mesh.triMaterials;
    let start = 0;
    for (let t = 1; t <= ids.length; t++) {
      if (t === ids.length || ids[t] !== ids[start]) {
        geometry.addGroup(start * 3, (t - start) * 3, ids[start]);
        start = t;
      }
    }

    const object = new THREE.Mesh(geometry, palette);
    object.name = mesh.name;
    group.add(object);
  }
  return group;
}

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.model = null;
    this.preview = null;
    this.grid = null;
    this.wireframe = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;

    this.light = new THREE.DirectionalLight(0xffffff, 1.2);
    this.light.position.set(1, 2, 1.5);
    this.scene.add(this.light, new THREE.HemisphereLight(0xffffff, 0x444455, 0.4));

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  resize() {
    const { width, height } = this.canvas.parentElement.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  show(model) {
    if (this.model) {
      this.scene.remove(this.model);
      disposeObject(this.model);
    }
    this.setPreview(null);
    this.model = model;
    this.scene.add(model);
    this.fit();
  }

  setPreview(group) {
    if (this.preview) {
      this.scene.remove(this.preview);
      this.preview.traverse((child) => child.geometry?.dispose());
    }
    this.preview = group;
    if (group) this.scene.add(group);
    if (this.model) this.model.visible = !group;
    this.setWireframe(this.wireframe);
  }

  fit() {
    const target = this.preview || this.model;
    if (!target) return;
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;

    const dimensions = box.getSize(new THREE.Vector3());
    const size = dimensions.length() || 1;
    const center = box.getCenter(new THREE.Vector3());
    const distance = (size / 2 / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.05;

    this.camera.near = size / 1000;
    this.camera.far = size * 100;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(center).add(new THREE.Vector3(0.7, 0.45, 1).normalize().multiplyScalar(distance));
    this.controls.target.copy(center);
    this.controls.minDistance = size / 50;
    this.controls.maxDistance = size * 20;
    this.controls.update();
    this.light.position.copy(center).add(new THREE.Vector3(1, 2, 1.5).multiplyScalar(size));

    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
    }
    const span = Math.max(dimensions.x, dimensions.z) * 2.5 || size;
    this.grid = new THREE.GridHelper(span, 20, 0x2a2a2a, 0x161616);
    this.grid.position.set(center.x, box.min.y, center.z);
    this.scene.add(this.grid);
  }

  setWireframe(enabled) {
    this.wireframe = enabled;
    this.scene.traverse((object) => {
      if (object.userData.wireOverlay) {
        object.visible = enabled;
        return;
      }
      if (!enabled || !object.isMesh || object.userData.hasWire) return;

      let overlay;
      if (object.isSkinnedMesh) {
        overlay = new THREE.SkinnedMesh(object.geometry, wireMaterial);
        overlay.bind(object.skeleton, object.bindMatrix);
      } else {
        overlay = new THREE.Mesh(object.geometry, wireMaterial);
      }
      overlay.morphTargetInfluences = object.morphTargetInfluences;
      overlay.userData.wireOverlay = true;
      overlay.renderOrder = 1;
      object.userData.hasWire = true;
      object.add(overlay);
    });
  }

  async exportGLB({ name, scale, animations, maxTextureSize }) {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const target = this.preview || this.model;
    const overlays = [];
    target.traverse((object) => {
      if (object.userData.wireOverlay) overlays.push(object);
      object.userData.hasWire = false;
    });
    for (const overlay of overlays) overlay.removeFromParent();

    const root = new THREE.Group();
    root.name = name;
    root.scale.setScalar(scale);
    this.scene.remove(target);
    root.add(target);

    try {
      return await new GLTFExporter().parseAsync(root, {
        binary: true,
        animations: this.preview ? [] : animations,
        maxTextureSize,
      });
    } finally {
      root.remove(target);
      this.scene.add(target);
      this.setWireframe(this.wireframe);
    }
  }
}
