import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { IFCLoader } from 'web-ifc-three';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';
import { VRMLLoader } from 'three/addons/loaders/VRMLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

let scene, camera, perspectiveCamera, orthoCamera, renderer, controls;
let currentModel = null;
let autoRotate = false;
let settingsMode = false;
let lightingEnabled = true;
let wireframeEnabled = false;
let isometricMode = false;
let targetMoveMode = false;
let isDraggingTarget = false;
let lights = {};
let lightBackground = false;
let gridHelper = null;
let gridVisible = false;

// Ruler state
let rulerMode = false;
let measurements = [];
let selectedMeasurementIndex = -1;
let isDraggingRulerPoint = null;
let modelScaleFactor = 1;
let modelUnitConversion = 1;
let raycaster = null;
let useMetric = true;

function initScene() {
    const viewer = document.getElementById('viewer');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
    scene.fog = new THREE.Fog(0x0a0a0a, 10, 50);

    perspectiveCamera = new THREE.PerspectiveCamera(
        50,
        viewer.clientWidth / viewer.clientHeight,
        0.1,
        1000
    );
    perspectiveCamera.position.set(5, 5, 5);

    const aspect = viewer.clientWidth / viewer.clientHeight;
    const frustumSize = 10;
    orthoCamera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.1,
        1000
    );
    orthoCamera.position.set(5, 5, 5);

    camera = perspectiveCamera;

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance'
    });
    renderer.setSize(viewer.clientWidth, viewer.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    viewer.appendChild(renderer.domElement);

    lights.ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(lights.ambient);

    lights.directional1 = new THREE.DirectionalLight(0xffffff, 0.8);
    lights.directional1.position.set(5, 10, 5);
    lights.directional1.castShadow = true;
    scene.add(lights.directional1);

    lights.directional2 = new THREE.DirectionalLight(0xffffff, 0.4);
    lights.directional2.position.set(-5, 5, -5);
    scene.add(lights.directional2);

    lights.directional3 = new THREE.DirectionalLight(0xffffff, 0.2);
    lights.directional3.position.set(0, -5, 0);
    scene.add(lights.directional3);

    gridHelper = new THREE.GridHelper(20, 20, 0x333333, 0x1a1a1a);
    gridHelper.visible = false;
    scene.add(gridHelper);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 0.5;
    controls.maxDistance = 100;
    controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN
    };

    controls.addEventListener('change', () => {
        const distance = camera.position.distanceTo(controls.target);
        controls.rotateSpeed = Math.min(1.0, Math.max(0.2, distance / 10));
    });

    raycaster = new THREE.Raycaster();

    window.addEventListener('resize', onWindowResize);

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onWindowResize);
    }

    animate();
}

function onWindowResize() {
    const viewer = document.getElementById('viewer');
    if (!viewer || viewer.clientWidth === 0 || viewer.clientHeight === 0) return;

    const aspect = viewer.clientWidth / viewer.clientHeight;

    perspectiveCamera.aspect = aspect;
    perspectiveCamera.updateProjectionMatrix();

    if (isometricMode && controls) {
        const distance = camera.position.distanceTo(controls.target);
        const frustumSize = distance * 1.5;
        orthoCamera.left = -frustumSize * aspect / 2;
        orthoCamera.right = frustumSize * aspect / 2;
        orthoCamera.top = frustumSize / 2;
        orthoCamera.bottom = -frustumSize / 2;
    } else {
        const frustumSize = 10;
        orthoCamera.left = -frustumSize * aspect / 2;
        orthoCamera.right = frustumSize * aspect / 2;
        orthoCamera.top = frustumSize / 2;
        orthoCamera.bottom = -frustumSize / 2;
    }
    orthoCamera.updateProjectionMatrix();

    renderer.setSize(viewer.clientWidth, viewer.clientHeight);

    if (targetMoveMode && !isDraggingTarget) {
        centerTargetIndicator();
    }
}

function animate() {
    requestAnimationFrame(animate);

    if (autoRotate && controls) {
        const rotationSpeed = 0.005;
        const x = camera.position.x;
        const z = camera.position.z;
        camera.position.x = x * Math.cos(rotationSpeed) - z * Math.sin(rotationSpeed);
        camera.position.z = x * Math.sin(rotationSpeed) + z * Math.cos(rotationSpeed);
        camera.lookAt(controls.target);
    }

    controls.update();

    if (rulerMode && measurements.length > 0) {
        updateAllMeasurements();
    }

    renderer.render(scene, camera);
}

let currentFileType = 'dae';

function loadModel(fileContent, fileType = 'dae') {
    currentFileType = fileType;
    return new Promise((resolve, reject) => {
        const loading = document.getElementById('loading');
        const errorMsg = document.getElementById('error-msg');

        loading.style.display = 'block';
        errorMsg.style.display = 'none';

        if (currentModel) {
            scene.remove(currentModel);
            currentModel = null;
        }

        function finalizeModel(model) {
            currentModel = model;

            const box = new THREE.Box3().setFromObject(currentModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = maxDim > 0 ? 5 / maxDim : 1;

            modelScaleFactor = scale;

            if (currentFileType === 'ifc') {
                if (maxDim > 1000) {
                    modelUnitConversion = 0.001;
                } else if (maxDim > 50) {
                    modelUnitConversion = 0.0254;
                } else {
                    modelUnitConversion = 1;
                }
            } else if (currentFileType === 'stl') {
                if (maxDim > 100) {
                    modelUnitConversion = 0.001;
                } else {
                    modelUnitConversion = 1;
                }
            } else if (currentFileType === 'glb') {
                modelUnitConversion = 1;
            } else {
                if (maxDim > 1000) {
                    modelUnitConversion = 0.001;
                } else {
                    modelUnitConversion = 1;
                }
            }

            currentModel.scale.multiplyScalar(scale);
            currentModel.position.sub(center.multiplyScalar(scale));

            scene.add(currentModel);

            if (wireframeEnabled) {
                currentModel.traverse((child) => {
                    if (child.isMesh && child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => { mat.wireframe = true; });
                        } else {
                            child.material.wireframe = true;
                        }
                    }
                });
            }

            loading.style.display = 'none';

            camera.position.set(5, 5, 5);
            camera.lookAt(0, 0, 0);
            controls.reset();
            resolve();
        }

        function handleError(error) {
            loading.style.display = 'none';
            errorMsg.textContent = 'Error parsing ' + fileType.toUpperCase() + ' file: ' + error.message;
            errorMsg.style.display = 'block';
            console.error('Loader error:', error);
            reject(error);
        }

        try {
            let model;

            if (fileType === 'obj') {
                const loader = new OBJLoader();
                model = loader.parse(fileContent);
                model.traverse((child) => {
                    if (child.isMesh && !child.material) {
                        child.material = new THREE.MeshStandardMaterial({ color: 0x888888 });
                    }
                });
                finalizeModel(model);
            } else if (fileType === 'dae') {
                const loader = new ColladaLoader();
                const collada = loader.parse(fileContent);
                model = collada.scene;
                finalizeModel(model);
            } else if (fileType === 'glb') {
                const loader = new GLTFLoader();
                loader.parse(fileContent, '', (gltf) => {
                    finalizeModel(gltf.scene);
                }, (error) => {
                    handleError(error);
                });
            } else if (fileType === 'stl') {
                const loader = new STLLoader();
                const geometry = loader.parse(fileContent);
                const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
                model = new THREE.Mesh(geometry, material);
                finalizeModel(model);
            } else if (fileType === 'fbx') {
                const loader = new FBXLoader();
                model = loader.parse(fileContent);
                finalizeModel(model);
            } else if (fileType === 'ifc') {
                (async () => {
                    try {
                        const loader = new IFCLoader();
                        await loader.ifcManager.setWasmPath('https://cdn.jsdelivr.net/npm/web-ifc@0.0.36/', true);
                        const blob = new Blob([fileContent], { type: 'application/x-step' });
                        const url = URL.createObjectURL(blob);
                        loader.load(url, (ifcModel) => {
                            URL.revokeObjectURL(url);
                            finalizeModel(ifcModel.mesh || ifcModel);
                        }, undefined, (error) => {
                            URL.revokeObjectURL(url);
                            handleError(error);
                        });
                    } catch (error) {
                        handleError(error);
                    }
                })();
            } else if (fileType === '3ds') {
                const loader = new TDSLoader();
                model = loader.parse(fileContent);
                finalizeModel(model);
            } else if (fileType === 'wrl') {
                const loader = new VRMLLoader();
                model = loader.parse(fileContent);
                finalizeModel(model);
            } else if (fileType === 'ply') {
                const loader = new PLYLoader();
                const geometry = loader.parse(fileContent);
                const material = new THREE.MeshStandardMaterial({ color: 0x888888, vertexColors: geometry.hasAttribute('color') });
                model = new THREE.Mesh(geometry, material);
                finalizeModel(model);
            } else {
                throw new Error('Unsupported file type: ' + fileType);
            }
        } catch (error) {
            handleError(error);
        }
    });
}

async function openFile(file) {
    const errorMsg = document.getElementById('error-msg');
    const loading = document.getElementById('loading');
    const loadingText = document.getElementById('loading-text');

    loadingText.textContent = 'Loading...';
    loading.style.display = 'block';
    errorMsg.style.display = 'none';

    const fileExt = file.name.split('.').pop().toLowerCase();
    const isBinaryFormat = ['glb', 'stl', 'fbx', '3ds', 'ply'].includes(fileExt);

    const reader = new FileReader();
    const fileContentPromise = new Promise((resolve, reject) => {
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = () => reject(new Error('Error reading file'));
    });

    if (isBinaryFormat) {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file);
    }

    let fileContent;
    try {
        fileContent = await fileContentPromise;
    } catch (e) {
        loading.style.display = 'none';
        errorMsg.textContent = 'Error reading file';
        errorMsg.style.display = 'block';
        return;
    }

    try {
        await loadModel(fileContent, fileExt);
    } catch (e) {
        // Error is shown by loadModel
    }
}

// About modal
const aboutModal = document.getElementById('about-modal');
const aboutBtn = document.getElementById('about-btn');
const aboutModalClose = document.getElementById('about-modal-close');

aboutBtn.addEventListener('click', () => {
    aboutModal.showModal();
});

aboutModalClose.addEventListener('click', () => {
    aboutModal.close();
});

aboutModal.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) aboutModal.close();
});

// Privacy and Terms modals
const privacyModal = document.getElementById('privacy-modal');
const termsModal = document.getElementById('terms-modal');
const privacyLink = document.getElementById('privacy-link');
const termsLink = document.getElementById('terms-link');

privacyLink.addEventListener('click', (e) => {
    e.preventDefault();
    privacyModal.showModal();
});

termsLink.addEventListener('click', (e) => {
    e.preventDefault();
    termsModal.showModal();
});

document.getElementById('privacy-modal-close').addEventListener('click', () => privacyModal.close());
document.getElementById('terms-modal-close').addEventListener('click', () => termsModal.close());

privacyModal.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) privacyModal.close();
});

termsModal.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) termsModal.close();
});

// Open modal
const openModal = document.getElementById('open-modal');
const openBtn = document.getElementById('open-btn');
const openModalClose = document.getElementById('open-modal-close');
const fileInputModal = document.getElementById('file-input-modal');
const fileUploadLabelModal = document.querySelector('.file-upload-label-modal');

openBtn.addEventListener('click', () => {
    openModal.showModal();
});

openModalClose.addEventListener('click', () => {
    openModal.close();
    fileInputModal.value = '';
});

openModal.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        openModal.close();
        fileInputModal.value = '';
    }
});

fileInputModal.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    openModal.close();
    openFile(file);
});

fileUploadLabelModal.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileUploadLabelModal.classList.add('drag-over');
});

fileUploadLabelModal.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileUploadLabelModal.classList.remove('drag-over');
});

fileUploadLabelModal.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileUploadLabelModal.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        openModal.close();
        openFile(files[0]);
    }
});

// Toggle controls visibility
let controlsVisible = true;
const toggleControlsBtn = document.getElementById('toggle-controls');
const toggleIcon = toggleControlsBtn.querySelector('i');

const rulerControlsEl = document.getElementById('ruler-controls');
const rulerAddBtn = document.getElementById('ruler-add-btn');
const rulerRemoveBtn = document.getElementById('ruler-remove-btn');
const measurementsContainer = document.getElementById('ruler-measurements-container');

toggleControlsBtn.addEventListener('click', () => {
    controlsVisible = !controlsVisible;
    const viewerControls = document.querySelectorAll('.viewer-control');

    viewerControls.forEach(control => {
        control.classList.toggle('hidden', !controlsVisible);
    });

    toggleIcon.className = controlsVisible ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';

    const bgToggleBtn = document.getElementById('bg-toggle-btn');
    const dlBtn = document.getElementById('download-btn');
    if (controlsVisible) {
        bgToggleBtn.style.display = settingsMode ? 'flex' : 'none';
        dlBtn.style.display = settingsMode ? 'flex' : 'none';
    } else {
        dlBtn.style.display = 'none';
    }

    if (!controlsVisible && rulerMode) {
        measurements.forEach(m => {
            m.point1El.style.display = 'none';
            m.point2El.style.display = 'none';
            m.lineEl.style.display = 'none';
        });
        rulerControlsEl.style.display = 'none';
    } else if (controlsVisible && rulerMode) {
        measurements.forEach(m => {
            m.point1El.style.display = 'block';
            m.point2El.style.display = 'block';
            m.lineEl.style.display = 'block';
        });
        rulerControlsEl.style.display = 'flex';
    }
});

// Settings mode toggle
const settingsBtn = document.getElementById('settings-btn');
const panControls = document.getElementById('pan-controls');
const rotateBtn = document.getElementById('rotate-btn');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomInBtn = document.getElementById('zoom-in');
const sideviewBtn = document.getElementById('sideview-btn');
const topviewBtn = document.getElementById('topview-btn');
const lightingBtn = document.getElementById('lighting-btn');
const wireframeBtn = document.getElementById('wireframe-btn');
const targetBtn = document.getElementById('target-btn');
const leftControls = document.getElementById('left-controls');
const rulerBtn = document.getElementById('ruler-btn');
const downloadBtn = document.getElementById('download-btn');

settingsBtn.addEventListener('click', () => {
    settingsMode = !settingsMode;

    if (settingsMode) {
        panControls.style.display = 'none';
        rotateBtn.style.display = 'none';
        zoomOutBtn.style.display = 'none';
        zoomInBtn.style.display = 'none';
        sideviewBtn.style.display = 'flex';
        topviewBtn.style.display = 'flex';
        document.getElementById('bg-toggle-btn').style.display = 'flex';
        lightingBtn.style.display = 'flex';
        wireframeBtn.style.display = 'flex';
        leftControls.style.display = 'flex';
        downloadBtn.style.display = 'flex';
        settingsBtn.classList.add('active');
    } else {
        panControls.style.display = 'block';
        rotateBtn.style.display = 'flex';
        zoomOutBtn.style.display = 'flex';
        zoomInBtn.style.display = 'flex';
        sideviewBtn.style.display = 'none';
        topviewBtn.style.display = 'none';
        document.getElementById('bg-toggle-btn').style.display = 'none';
        lightingBtn.style.display = 'none';
        wireframeBtn.style.display = 'none';
        leftControls.style.display = 'none';
        downloadBtn.style.display = 'none';
        settingsBtn.classList.remove('active');

        if (targetMoveMode) toggleTargetMoveMode();
        if (rulerMode) toggleRulerMode();
    }
});

lightingBtn.addEventListener('click', () => {
    lightingEnabled = !lightingEnabled;

    if (lightingEnabled) {
        lights.ambient.intensity = 0.6;
        lights.directional1.intensity = 0.8;
        lights.directional2.intensity = 0.4;
        lights.directional3.intensity = 0.2;
        renderer.shadowMap.enabled = true;
        lightingBtn.classList.remove('active');
    } else {
        lights.ambient.intensity = 0.3;
        lights.directional1.intensity = 0;
        lights.directional2.intensity = 0;
        lights.directional3.intensity = 0;
        renderer.shadowMap.enabled = false;
        lightingBtn.classList.add('active');
    }
});

wireframeBtn.addEventListener('click', () => {
    wireframeEnabled = !wireframeEnabled;

    if (currentModel) {
        currentModel.traverse((child) => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => { mat.wireframe = wireframeEnabled; });
                } else {
                    child.material.wireframe = wireframeEnabled;
                }
            }
        });

        wireframeBtn.classList.toggle('active', wireframeEnabled);
    }
});

const gridBtn = document.getElementById('grid-btn');

gridBtn.addEventListener('click', () => {
    gridVisible = !gridVisible;
    if (gridHelper) gridHelper.visible = gridVisible;
    gridBtn.classList.toggle('active', gridVisible);
});

sideviewBtn.addEventListener('click', () => {
    if (!controls) return;
    const distance = camera.position.distanceTo(controls.target);
    camera.position.set(controls.target.x + distance, controls.target.y, controls.target.z);
    camera.lookAt(controls.target);
    controls.update();
});

topviewBtn.addEventListener('click', () => {
    if (!controls) return;
    const distance = camera.position.distanceTo(controls.target);
    camera.position.set(controls.target.x, controls.target.y + distance, controls.target.z);
    camera.lookAt(controls.target);
    controls.update();
});

// Target move mode
const targetIndicator = document.getElementById('target-indicator');

function toggleTargetMoveMode() {
    targetMoveMode = !targetMoveMode;

    if (targetMoveMode) {
        centerTargetIndicator();
        targetIndicator.style.display = 'block';
        targetBtn.classList.add('active');
    } else {
        targetIndicator.style.display = 'none';
        targetBtn.classList.remove('active');
    }
}

function centerTargetIndicator() {
    const viewer = document.getElementById('viewer');
    if (!viewer) return;
    const indicator = document.getElementById('target-indicator');
    if (!indicator) return;
    indicator.style.left = `${viewer.clientWidth / 2 - 10}px`;
    indicator.style.top = `${viewer.clientHeight / 2 - 10}px`;
}

function screenToWorld(screenX, screenY) {
    const viewer = document.getElementById('viewer');
    const rect = viewer.getBoundingClientRect();
    const x = ((screenX - rect.left) / viewer.clientWidth) * 2 - 1;
    const y = -((screenY - rect.top) / viewer.clientHeight) * 2 + 1;
    const distance = camera.position.distanceTo(controls.target);
    const vector = new THREE.Vector3(x, y, 0.5);
    vector.unproject(camera);
    const direction = vector.sub(camera.position).normalize();
    return camera.position.clone().add(direction.multiplyScalar(distance));
}

targetBtn.addEventListener('click', () => {
    toggleTargetMoveMode();
});

// Isometric camera toggle
const isoBtn = document.getElementById('iso-btn');

function toggleIsometricMode() {
    isometricMode = !isometricMode;

    const currentPosition = camera.position.clone();
    const currentTarget = controls.target.clone();

    if (isometricMode) {
        orthoCamera.position.copy(currentPosition);
        orthoCamera.lookAt(currentTarget);

        const distance = currentPosition.distanceTo(currentTarget);
        const viewer = document.getElementById('viewer');
        const aspect = viewer.clientWidth / viewer.clientHeight;
        const frustumSize = distance * 1.5;

        orthoCamera.left = -frustumSize * aspect / 2;
        orthoCamera.right = frustumSize * aspect / 2;
        orthoCamera.top = frustumSize / 2;
        orthoCamera.bottom = -frustumSize / 2;
        orthoCamera.updateProjectionMatrix();

        camera = orthoCamera;
        isoBtn.classList.add('active');
    } else {
        perspectiveCamera.position.copy(currentPosition);
        perspectiveCamera.lookAt(currentTarget);
        camera = perspectiveCamera;
        isoBtn.classList.remove('active');
    }

    controls.object = camera;
    controls.update();
}

isoBtn.addEventListener('click', () => {
    toggleIsometricMode();
});

// Target indicator drag
targetIndicator.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDraggingTarget = true;
});

document.addEventListener('mousemove', (e) => {
    if (!isDraggingTarget || !targetMoveMode) return;
    const viewer = document.getElementById('viewer');
    const rect = viewer.getBoundingClientRect();
    targetIndicator.style.left = `${e.clientX - rect.left - 10}px`;
    targetIndicator.style.top = `${e.clientY - rect.top - 10}px`;
});

document.addEventListener('mouseup', (e) => {
    if (!isDraggingTarget || !targetMoveMode) return;
    isDraggingTarget = false;
    const newTarget = screenToWorld(e.clientX, e.clientY);
    controls.target.copy(newTarget);
    controls.update();
    centerTargetIndicator();
});

targetIndicator.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isDraggingTarget = true;
});

document.addEventListener('touchmove', (e) => {
    if (!isDraggingTarget || !targetMoveMode) return;
    const touch = e.touches[0];
    const viewer = document.getElementById('viewer');
    const rect = viewer.getBoundingClientRect();
    targetIndicator.style.left = `${touch.clientX - rect.left - 10}px`;
    targetIndicator.style.top = `${touch.clientY - rect.top - 10}px`;
});

document.addEventListener('touchend', (e) => {
    if (!isDraggingTarget || !targetMoveMode) return;
    isDraggingTarget = false;
    const touch = e.changedTouches[0];
    const newTarget = screenToWorld(touch.clientX, touch.clientY);
    controls.target.copy(newTarget);
    controls.update();
    centerTargetIndicator();
});

// Ruler functionality
function toggleRulerMode() {
    rulerMode = !rulerMode;

    if (rulerMode) {
        if (measurements.length === 0) {
            addMeasurement();
        } else {
            measurements.forEach(m => {
                m.point1El.style.display = 'block';
                m.point2El.style.display = 'block';
                m.lineEl.style.display = 'block';
            });
            updateAllMeasurements();
        }
        rulerControlsEl.style.display = 'flex';
        rulerBtn.classList.add('active');
        updateRemoveButtonState();
    } else {
        measurements.forEach(m => {
            m.point1El.style.display = 'none';
            m.point2El.style.display = 'none';
            m.lineEl.style.display = 'none';
        });
        rulerControlsEl.style.display = 'none';
        rulerBtn.classList.remove('active');
        selectedMeasurementIndex = -1;
    }
}

function createMeasurementElements(index) {
    const viewer = document.getElementById('viewer');

    const point1El = document.createElement('div');
    point1El.className = 'ruler-point';
    point1El.dataset.measurementIndex = index;
    point1El.dataset.pointNum = '1';
    viewer.appendChild(point1El);

    const point2El = document.createElement('div');
    point2El.className = 'ruler-point';
    point2El.dataset.measurementIndex = index;
    point2El.dataset.pointNum = '2';
    viewer.appendChild(point2El);

    const lineEl = document.createElement('div');
    lineEl.className = 'ruler-line';
    lineEl.dataset.measurementIndex = index;
    const measurementEl = document.createElement('div');
    measurementEl.className = 'ruler-measurement';
    lineEl.appendChild(measurementEl);
    viewer.appendChild(lineEl);

    point1El.addEventListener('click', () => {
        if (!isDraggingRulerPoint) selectMeasurement(parseInt(point1El.dataset.measurementIndex));
    });
    point2El.addEventListener('click', () => {
        if (!isDraggingRulerPoint) selectMeasurement(parseInt(point2El.dataset.measurementIndex));
    });

    setupPointDragHandlers(point1El);
    setupPointDragHandlers(point2El);

    measurementEl.addEventListener('click', (e) => {
        e.stopPropagation();
        useMetric = !useMetric;
        updateAllMeasurements();
    });
    measurementEl.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        useMetric = !useMetric;
        updateAllMeasurements();
    });

    return { point1El, point2El, lineEl, measurementEl };
}

function setupPointDragHandlers(pointEl) {
    pointEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = parseInt(pointEl.dataset.measurementIndex);
        const pointNum = parseInt(pointEl.dataset.pointNum);
        isDraggingRulerPoint = { measurementIndex: idx, pointNum };
        pointEl.classList.add('dragging');
        controls.enabled = false;
        selectMeasurement(idx);
    });

    pointEl.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const idx = parseInt(pointEl.dataset.measurementIndex);
        const pointNum = parseInt(pointEl.dataset.pointNum);
        isDraggingRulerPoint = { measurementIndex: idx, pointNum };
        pointEl.classList.add('dragging');
        controls.enabled = false;
        selectMeasurement(idx);
    });
}

function addMeasurement() {
    const viewer = document.getElementById('viewer');
    const centerX = viewer.clientWidth / 2;
    const centerY = viewer.clientHeight / 2;
    const offset = 50;

    const index = measurements.length;
    const elements = createMeasurementElements(index);

    const point1Screen = { x: centerX - offset, y: centerY };
    const point2Screen = { x: centerX + offset, y: centerY };
    const point1World = raycastToSurface(point1Screen.x, point1Screen.y) || screenToWorldAtDistance(point1Screen.x, point1Screen.y);
    const point2World = raycastToSurface(point2Screen.x, point2Screen.y) || screenToWorldAtDistance(point2Screen.x, point2Screen.y);

    const measurement = {
        point1World,
        point2World,
        point1El: elements.point1El,
        point2El: elements.point2El,
        lineEl: elements.lineEl,
        measurementEl: elements.measurementEl
    };

    measurements.push(measurement);

    elements.point1El.style.display = 'block';
    elements.point2El.style.display = 'block';
    elements.lineEl.style.display = 'block';

    selectMeasurement(index);
    updateMeasurementLine(index);
    updateRemoveButtonState();
}

function removeMeasurement(index) {
    if (index < 0 || index >= measurements.length) return;

    const measurement = measurements[index];
    measurement.point1El.remove();
    measurement.point2El.remove();
    measurement.lineEl.remove();

    measurements.splice(index, 1);

    measurements.forEach((m, i) => {
        m.point1El.dataset.measurementIndex = i;
        m.point2El.dataset.measurementIndex = i;
        m.lineEl.dataset.measurementIndex = i;
    });

    if (measurements.length === 0) {
        selectedMeasurementIndex = -1;
    } else if (selectedMeasurementIndex >= measurements.length) {
        selectedMeasurementIndex = measurements.length - 1;
        updateSelectionVisuals();
    } else {
        updateSelectionVisuals();
    }

    updateRemoveButtonState();
}

function selectMeasurement(index) {
    selectedMeasurementIndex = index;
    updateSelectionVisuals();
    updateRemoveButtonState();
}

function updateSelectionVisuals() {
    measurements.forEach((m, i) => {
        const selected = i === selectedMeasurementIndex;
        m.point1El.classList.toggle('selected', selected);
        m.point2El.classList.toggle('selected', selected);
        m.lineEl.classList.toggle('selected', selected);
    });
}

function updateRemoveButtonState() {
    rulerRemoveBtn.disabled = selectedMeasurementIndex < 0;
}

function raycastToSurface(screenX, screenY) {
    if (!currentModel || !raycaster) return null;

    const viewer = document.getElementById('viewer');
    const rect = viewer.getBoundingClientRect();
    const x = ((screenX - rect.left) / viewer.clientWidth) * 2 - 1;
    const y = -((screenY - rect.top) / viewer.clientHeight) * 2 + 1;

    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    const intersects = raycaster.intersectObject(currentModel, true);

    if (intersects.length > 0) {
        const hit = intersects[0];
        const hitPoint = hit.point.clone();

        if (hit.face && hit.object.geometry) {
            const geometry = hit.object.geometry;
            const matrixWorld = hit.object.matrixWorld;
            const position = geometry.attributes.position;
            if (!position) return hitPoint;

            const faceIndices = geometry.index
                ? [geometry.index.getX(hit.faceIndex * 3),
                   geometry.index.getX(hit.faceIndex * 3 + 1),
                   geometry.index.getX(hit.faceIndex * 3 + 2)]
                : [hit.faceIndex * 3, hit.faceIndex * 3 + 1, hit.faceIndex * 3 + 2];

            const vertices = faceIndices.map(i => {
                const v = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
                v.applyMatrix4(matrixWorld);
                return v;
            });

            let closestVertex = null;
            let closestVertexDist = Infinity;
            for (const v of vertices) {
                const dist = hitPoint.distanceTo(v);
                if (dist < closestVertexDist) {
                    closestVertexDist = dist;
                    closestVertex = v;
                }
            }

            let closestEdgePoint = null;
            let closestEdgeDist = Infinity;
            for (let i = 0; i < 3; i++) {
                const v1 = vertices[i];
                const v2 = vertices[(i + 1) % 3];
                const edgePoint = closestPointOnLineSegment(hitPoint, v1, v2);
                const dist = hitPoint.distanceTo(edgePoint);
                if (dist < closestEdgeDist) {
                    closestEdgeDist = dist;
                    closestEdgePoint = edgePoint;
                }
            }

            const snapThreshold = 0.5 / modelScaleFactor;

            if (closestVertexDist < snapThreshold * 0.5) {
                return closestVertex;
            } else if (closestEdgeDist < snapThreshold) {
                return closestEdgePoint;
            }
        }

        return hitPoint;
    }

    return null;
}

function closestPointOnLineSegment(point, v1, v2) {
    const line = new THREE.Vector3().subVectors(v2, v1);
    const len = line.length();
    line.normalize();
    const toPoint = new THREE.Vector3().subVectors(point, v1);
    let t = toPoint.dot(line);
    t = Math.max(0, Math.min(len, t));
    return new THREE.Vector3().copy(v1).addScaledVector(line, t);
}

function screenToWorldAtDistance(screenX, screenY) {
    const viewer = document.getElementById('viewer');
    const rect = viewer.getBoundingClientRect();
    const x = ((screenX - rect.left) / viewer.clientWidth) * 2 - 1;
    const y = -((screenY - rect.top) / viewer.clientHeight) * 2 + 1;
    const distance = camera.position.distanceTo(controls.target);
    const vector = new THREE.Vector3(x, y, 0.5);
    vector.unproject(camera);
    const direction = vector.sub(camera.position).normalize();
    return camera.position.clone().add(direction.multiplyScalar(distance));
}

function worldToScreen(worldPos) {
    const viewer = document.getElementById('viewer');
    const vector = worldPos.clone();
    vector.project(camera);
    const x = (vector.x * 0.5 + 0.5) * viewer.clientWidth;
    const y = (-vector.y * 0.5 + 0.5) * viewer.clientHeight;
    return { x, y };
}

function updateAllMeasurements() {
    measurements.forEach((m, i) => updateMeasurementLine(i));
}

function updateMeasurementLine(index) {
    const m = measurements[index];
    if (!m || !rulerMode || !m.point1World || !m.point2World) return;

    const screen1 = worldToScreen(m.point1World);
    const screen2 = worldToScreen(m.point2World);

    m.point1El.style.left = `${screen1.x - 10}px`;
    m.point1El.style.top = `${screen1.y - 10}px`;
    m.point2El.style.left = `${screen2.x - 10}px`;
    m.point2El.style.top = `${screen2.y - 10}px`;

    const dx = screen2.x - screen1.x;
    const dy = screen2.y - screen1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    m.lineEl.style.left = `${screen1.x}px`;
    m.lineEl.style.top = `${screen1.y}px`;
    m.lineEl.style.width = `${length}px`;
    m.lineEl.style.transform = `rotate(${angle}deg)`;

    if (angle > 90 || angle < -90) {
        m.measurementEl.style.transform = 'translateX(-50%) rotate(180deg)';
        m.measurementEl.style.top = '8px';
    } else {
        m.measurementEl.style.transform = 'translateX(-50%)';
        m.measurementEl.style.top = '-24px';
    }

    const worldDistance = m.point1World.distanceTo(m.point2World);
    const originalDistance = (worldDistance / modelScaleFactor) * modelUnitConversion;
    m.measurementEl.textContent = formatDistance(originalDistance);
}

function formatDistance(originalDistance) {
    if (useMetric) {
        if (originalDistance >= 1) {
            return `${originalDistance.toFixed(2)} m`;
        } else if (originalDistance >= 0.01) {
            return `${(originalDistance * 100).toFixed(1)} cm`;
        } else {
            return `${(originalDistance * 1000).toFixed(1)} mm`;
        }
    } else {
        const totalInches = originalDistance * 39.3701;

        function inchesToFraction(inches) {
            const wholeInches = Math.floor(inches);
            const decimal = inches - wholeInches;
            const sixteenths = Math.round(decimal * 16);

            if (sixteenths === 0) return wholeInches > 0 ? `${wholeInches}` : '0';
            if (sixteenths === 16) return `${wholeInches + 1}`;

            let num = sixteenths;
            let den = 16;
            while (num % 2 === 0 && den % 2 === 0) { num /= 2; den /= 2; }

            return wholeInches > 0 ? `${wholeInches} ${num}/${den}` : `${num}/${den}`;
        }

        if (totalInches >= 12) {
            const feet = Math.floor(totalInches / 12);
            const inches = totalInches % 12;
            if (inches < 0.03125) return `${feet}'`;
            return `${feet}' ${inchesToFraction(inches)}"`;
        } else {
            return `${inchesToFraction(totalInches)}"`;
        }
    }
}

function updateRulerPointPosition(measurementIndex, pointNum, screenX, screenY) {
    const m = measurements[measurementIndex];
    if (!m) return;

    const viewer = document.getElementById('viewer');
    const rect = viewer.getBoundingClientRect();

    const worldPos = raycastToSurface(screenX, screenY);

    if (worldPos) {
        if (pointNum === 1) m.point1World = worldPos;
        else m.point2World = worldPos;
    } else {
        const projectedPos = screenToWorldAtDistance(screenX, screenY);
        if (pointNum === 1) m.point1World = projectedPos;
        else m.point2World = projectedPos;
    }

    const point = pointNum === 1 ? m.point1El : m.point2El;
    point.style.left = `${screenX - rect.left - 10}px`;
    point.style.top = `${screenY - rect.top - 10}px`;

    updateMeasurementLine(measurementIndex);
}

rulerBtn.addEventListener('click', () => toggleRulerMode());
rulerAddBtn.addEventListener('click', () => addMeasurement());
rulerRemoveBtn.addEventListener('click', () => {
    if (selectedMeasurementIndex >= 0) removeMeasurement(selectedMeasurementIndex);
});

document.addEventListener('mousemove', (e) => {
    if (!isDraggingRulerPoint || !rulerMode) return;
    updateRulerPointPosition(isDraggingRulerPoint.measurementIndex, isDraggingRulerPoint.pointNum, e.clientX, e.clientY);
});

document.addEventListener('mouseup', () => {
    if (isDraggingRulerPoint) {
        const m = measurements[isDraggingRulerPoint.measurementIndex];
        if (m) {
            m.point1El.classList.remove('dragging');
            m.point2El.classList.remove('dragging');
        }
        isDraggingRulerPoint = null;
        controls.enabled = true;
    }
});

document.addEventListener('touchmove', (e) => {
    if (!isDraggingRulerPoint || !rulerMode) return;
    const touch = e.touches[0];
    updateRulerPointPosition(isDraggingRulerPoint.measurementIndex, isDraggingRulerPoint.pointNum, touch.clientX, touch.clientY);
});

document.addEventListener('touchend', () => {
    if (isDraggingRulerPoint) {
        const m = measurements[isDraggingRulerPoint.measurementIndex];
        if (m) {
            m.point1El.classList.remove('dragging');
            m.point2El.classList.remove('dragging');
        }
        isDraggingRulerPoint = null;
        controls.enabled = true;
    }
});

// Download
function downloadImage() {
    if (!renderer || !scene || !camera) return;

    const exportSize = 2048;
    const viewer = document.getElementById('viewer');
    const viewerWidth = viewer.clientWidth;
    const viewerHeight = viewer.clientHeight;

    renderer.render(scene, camera);

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = exportSize;
    exportCanvas.height = exportSize;
    const ctx = exportCanvas.getContext('2d');

    ctx.fillStyle = lightBackground ? '#ffffff' : '#0a0a0a';
    ctx.fillRect(0, 0, exportSize, exportSize);

    let drawWidth, drawHeight;
    if (viewerWidth > viewerHeight) {
        drawWidth = exportSize;
        drawHeight = exportSize * viewerHeight / viewerWidth;
    } else {
        drawHeight = exportSize;
        drawWidth = exportSize * viewerWidth / viewerHeight;
    }

    const offsetX = (exportSize - drawWidth) / 2;
    const offsetY = (exportSize - drawHeight) / 2;

    ctx.drawImage(renderer.domElement, offsetX, offsetY, drawWidth, drawHeight);

    if (rulerMode && measurements.length > 0) {
        const canvasWidth = renderer.domElement.width;
        const canvasHeight = renderer.domElement.height;
        const scaleX = drawWidth / canvasWidth;
        const scaleY = drawHeight / canvasHeight;
        const pixelRatio = renderer.getPixelRatio();

        measurements.forEach(m => {
            if (!m.point1World || !m.point2World) return;

            const screen1 = worldToScreen(m.point1World);
            const screen2 = worldToScreen(m.point2World);

            const p1 = {
                x: screen1.x * pixelRatio * scaleX + offsetX,
                y: screen1.y * pixelRatio * scaleY + offsetY
            };
            const p2 = {
                x: screen2.x * pixelRatio * scaleX + offsetX,
                y: screen2.y * pixelRatio * scaleY + offsetY
            };

            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();

            ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.arc(p1.x, p1.y, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(p2.x, p2.y, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            const label = m.measurementEl.textContent;

            ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const metrics = ctx.measureText(label);
            const padding = 6;
            const bgWidth = metrics.width + padding * 2;
            const bgHeight = 20;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(midX - bgWidth / 2, midY - bgHeight / 2 - 20, bgWidth, bgHeight);

            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, midX, midY - 20);
        });
    }

    const dataURL = exportCanvas.toDataURL('image/jpeg', 0.9);
    const link = document.createElement('a');
    link.download = '3d-viewer-export.jpg';
    link.href = dataURL;
    link.click();
}

downloadBtn.addEventListener('click', downloadImage);

// Background toggle
const bgToggleBtn = document.getElementById('bg-toggle-btn');

bgToggleBtn.addEventListener('click', () => {
    lightBackground = !lightBackground;

    if (lightBackground) {
        scene.background = new THREE.Color(0xffffff);
        scene.fog = new THREE.Fog(0xffffff, 10, 50);
        bgToggleBtn.classList.add('light-bg');
    } else {
        scene.background = new THREE.Color(0x0a0a0a);
        scene.fog = new THREE.Fog(0x0a0a0a, 10, 50);
        bgToggleBtn.classList.remove('light-bg');
    }
});

// Rotate
rotateBtn.addEventListener('click', () => {
    autoRotate = !autoRotate;
    rotateBtn.classList.toggle('active', autoRotate);
});

// Zoom
const ZOOM_SPEED = 0.5;
const ORTHO_ZOOM_FACTOR = 0.9;

function zoomCamera(direction) {
    if (!controls) return;

    if (isometricMode) {
        const factor = direction === 'in' ? ORTHO_ZOOM_FACTOR : (1 / ORTHO_ZOOM_FACTOR);
        orthoCamera.left *= factor;
        orthoCamera.right *= factor;
        orthoCamera.top *= factor;
        orthoCamera.bottom *= factor;
        orthoCamera.updateProjectionMatrix();
    } else {
        const zoomDirection = new THREE.Vector3();
        camera.getWorldDirection(zoomDirection);
        zoomDirection.multiplyScalar(direction === 'in' ? ZOOM_SPEED : -ZOOM_SPEED);
        camera.position.add(zoomDirection);
    }
    controls.update();
}

document.getElementById('zoom-in').addEventListener('click', () => zoomCamera('in'));
document.getElementById('zoom-out').addEventListener('click', () => zoomCamera('out'));

let zoomInterval = null;

function startZoom(direction) {
    zoomCamera(direction);
    zoomInterval = setInterval(() => zoomCamera(direction), 50);
}

function stopZoom() {
    if (zoomInterval) {
        clearInterval(zoomInterval);
        zoomInterval = null;
    }
}

['zoom-in', 'zoom-out'].forEach(id => {
    const button = document.getElementById(id);
    const direction = id === 'zoom-in' ? 'in' : 'out';

    button.addEventListener('touchstart', (e) => { e.preventDefault(); startZoom(direction); });
    button.addEventListener('touchend', (e) => { e.preventDefault(); stopZoom(); });
    button.addEventListener('mousedown', () => startZoom(direction));
    button.addEventListener('mouseup', stopZoom);
    button.addEventListener('mouseleave', stopZoom);
});

// Pan
const PAN_SPEED = 0.2;

function panCamera(direction) {
    if (!controls) return;

    const panOffset = new THREE.Vector3();
    const cameraRight = new THREE.Vector3();
    const cameraUp = new THREE.Vector3();

    camera.getWorldDirection(cameraRight);
    cameraRight.cross(camera.up).normalize();
    cameraUp.copy(camera.up).normalize();

    switch(direction) {
        case 'left':  panOffset.copy(cameraRight).multiplyScalar(-PAN_SPEED); break;
        case 'right': panOffset.copy(cameraRight).multiplyScalar(PAN_SPEED); break;
        case 'up':    panOffset.copy(cameraUp).multiplyScalar(PAN_SPEED); break;
        case 'down':  panOffset.copy(cameraUp).multiplyScalar(-PAN_SPEED); break;
    }

    camera.position.add(panOffset);
    controls.target.add(panOffset);
    controls.update();
}

document.getElementById('pan-up').addEventListener('click', () => panCamera('up'));
document.getElementById('pan-down').addEventListener('click', () => panCamera('down'));
document.getElementById('pan-left').addEventListener('click', () => panCamera('left'));
document.getElementById('pan-right').addEventListener('click', () => panCamera('right'));

let panInterval = null;

function startPan(direction) {
    panCamera(direction);
    panInterval = setInterval(() => panCamera(direction), 50);
}

function stopPan() {
    if (panInterval) {
        clearInterval(panInterval);
        panInterval = null;
    }
}

['pan-up', 'pan-down', 'pan-left', 'pan-right'].forEach(id => {
    const button = document.getElementById(id);
    const direction = id.replace('pan-', '');

    button.addEventListener('touchstart', (e) => { e.preventDefault(); startPan(direction); });
    button.addEventListener('touchend', (e) => { e.preventDefault(); stopPan(); });
    button.addEventListener('mousedown', () => startPan(direction));
    button.addEventListener('mouseup', stopPan);
    button.addEventListener('mouseleave', stopPan);
});

// Initialize
initScene();

// Load default model
fetch('./AC20-FZK-Haus.ifc')
    .then(response => response.text())
    .then(content => loadModel(content, 'ifc'))
    .catch(error => console.log('Could not load default model:', error));
