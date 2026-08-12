import { useEffect, useRef, useState, useCallback, type FC } from 'react';
import { Niivue } from '@niivue/niivue';
import { X, Maximize2, Minimize2, Activity, ChevronLeft, ChevronRight, Trash2, Download, Calculator, Info, Pencil, Eraser, Square, BarChart3, Wand2, MoveHorizontal, ArrowUp, ArrowDown, ArrowLeftIcon, ArrowRightIcon, Upload } from 'lucide-react';
import type { Session, ALPSResults, SavedALPSRois } from '../api';
import { getAlpsRois, getAlpsResults } from '../api';

// Simulation result interface
interface SimulationResult {
    session_id: string;
    rotation_axis: string;
    hemisphere: string;
    angles: number[];
    classic: (number | null)[];
    alps_pas: (number | null)[];
    refined: (number | null)[];
    refined_local: (number | null)[];
}

// Shape ROI interfaces for interactive drawing
interface ShapeROI {
    id: string;
    type: 'rectangle' | 'ellipse';
    roiType: 'proj' | 'assoc';      // SCR (blue) or SLF (green)
    center: [number, number];        // Voxel coordinates (x, y)
    size: [number, number];          // Half-widths [hx, hy] in voxels
    zSlice: number;                  // Z slice this shape lives on
    rotation: number;                // Degrees (0-360)
}

interface DragState {
    mode: 'create' | 'move' | 'resize' | 'rotate' | null;
    shapeId: string | null;
    handle: 'center' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'rotate' | null;
    startPos: [number, number];      // Canvas coordinates at drag start
    startVoxel: [number, number];    // Voxel coordinates at drag start
    startShape: ShapeROI | null;     // Shape state at drag start
}

type HandleType = DragState['handle'];

interface DTIALPSViewerProps {
    session: Session;
    onClose: () => void;
}

// Pen values for different ROIs
const PEN_VALUE_PROJ = 1;  // Blue - SCR/Projection fibers
const PEN_VALUE_ASSOC = 2; // Green - SLF/Association fibers
const PEN_VALUE_ERASE = 0; // Erase

const DTIALPSViewer: FC<DTIALPSViewerProps> = ({ session, onClose }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const nvRef = useRef<Niivue | null>(null);
    // Track whether slice changes come from slider (true) or from NiiVue scroll (false)
    const sliceChangeFromSliderRef = useRef(false);

    // Shape-based ROI state
    const [shapes, setShapes] = useState<ShapeROI[]>([]);
    const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
    const [shapeType, setShapeType] = useState<'rectangle' | 'ellipse'>('rectangle');
    const [shapeRoiType, setShapeRoiType] = useState<'proj' | 'assoc'>('proj');
    const [dragState, setDragState] = useState<DragState>({
        mode: null,
        shapeId: null,
        handle: null,
        startPos: [0, 0],
        startVoxel: [0, 0],
        startShape: null
    });
    const [isShapeMode, setIsShapeMode] = useState(false); // Toggle between shape mode and freehand mode

    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    // Volume dimensions
    const [dims, setDims] = useState<[number, number, number]>([0, 0, 0]);

    // Slice navigation
    const [currentSlice, setCurrentSlice] = useState(0);
    const [maxSlice, setMaxSlice] = useState(100);

    // Drawing mode: which ROI are we drawing, or erasing, or null (navigation)
    // 'proj'/'assoc' = freehand paint, 'proj-fill'/'assoc-fill' = flood fill for ROI
    const [drawingMode, setDrawingMode] = useState<'proj' | 'assoc' | 'proj-fill' | 'assoc-fill' | 'erase' | null>(null);

    // Voxel counts (calculated from drawBitmap)
    const [projVoxelCount, setProjVoxelCount] = useState(0);
    const [assocVoxelCount, setAssocVoxelCount] = useState(0);
    const [projLeftCount, setProjLeftCount] = useState(0);
    const [projRightCount, setProjRightCount] = useState(0);
    const [assocLeftCount, setAssocLeftCount] = useState(0);
    const [assocRightCount, setAssocRightCount] = useState(0);

    // Shell / b-value selection for on-the-fly tensor fitting
    const [shellInfo, setShellInfo] = useState<{ b_value: number; n_directions: number }[]>([]);
    const [selectedBValue, setSelectedBValue] = useState<number | null>(null);
    const [isReloadingColorFA, setIsReloadingColorFA] = useState(false);

    // ALPS settings
    const [faThreshold, setFaThreshold] = useState(0.2);
    const [useFaCap, setUseFaCap] = useState(false);
    const [faCap, setFaCap] = useState(95);
    const [hemisphere, setHemisphere] = useState<'both' | 'left' | 'right'>('both');
    const [alpsResults, setAlpsResults] = useState<ALPSResults | null>(null);
    const [isComputing, setIsComputing] = useState(false);
    const [computeError, setComputeError] = useState<string | null>(null);

    // Simulation state
    const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
    const [isSimulating, setIsSimulating] = useState(false);
    const [simulationError, setSimulationError] = useState<string | null>(null);
    const [rotationAxis, setRotationAxis] = useState<'x' | 'y' | 'z'>('x');
    const [angleRange, setAngleRange] = useState(30);
    const [showSimulation, setShowSimulation] = useState(false);
    const [simHemisphere, setSimHemisphere] = useState<'left' | 'right'>('left');

    // Registration quality: 'fast' = affine only, 'standard' = FNIRT standard, 'fine' = FNIRT fine
    const [registrationQuality, setRegistrationQuality] = useState<'fast' | 'standard' | 'fine'>('standard');

    // Auto ROI state
    const [isGeneratingAutoROI, setIsGeneratingAutoROI] = useState(false);
    const [autoROIError, setAutoROIError] = useState<string | null>(null);
    const [autoROIInfo, setAutoROIInfo] = useState<{ voxelCounts: Record<string, number>; zSlice: number } | null>(null);
    const [autoROIMethod, setAutoROIMethod] = useState<string | null>(null);
    const [roiCenters, setRoiCenters] = useState<{
        proj_L: [number, number, number] | null;
        proj_R: [number, number, number] | null;
        assoc_L: [number, number, number] | null;
        assoc_R: [number, number, number] | null;
    } | null>(null);
    const [roiSizeVoxels, setRoiSizeVoxels] = useState<[number, number, number] | null>(null);
    const [roiNumSlices, setRoiNumSlices] = useState<number>(2); // Number of slices per ROI (1 or 2)

    // Mouse position DEC values for debugging
    const [mouseDecValues, setMouseDecValues] = useState<{ r: number; g: number; b: number; x: number; y: number; z: number } | null>(null);

    // Saved ROI state
    const [savedRoiMetadata, setSavedRoiMetadata] = useState<SavedALPSRois['metadata'] | null>(null);

    // Count voxels in the drawing bitmap
    const updateVoxelCounts = useCallback(() => {
        const nv = nvRef.current;
        if (!nv) return;

        const bitmap = (nv as any).drawBitmap;
        if (!bitmap) {
            setProjVoxelCount(0);
            setAssocVoxelCount(0);
            setProjLeftCount(0);
            setProjRightCount(0);
            setAssocLeftCount(0);
            setAssocRightCount(0);
            return;
        }

        // Get volume dimensions for left/right split
        const vol = nv.volumes?.[0];
        const xDim = vol?.dims?.[1] || 0;
        const midX = Math.floor(xDim / 2);

        let projCount = 0;
        let assocCount = 0;
        let projLeft = 0;
        let projRight = 0;
        let assocLeft = 0;
        let assocRight = 0;

        // Bitmap is in Fortran order (column-major): index = x + y*xDim + z*xDim*yDim
        for (let i = 0; i < bitmap.length; i++) {
            if (bitmap[i] === PEN_VALUE_PROJ || bitmap[i] === PEN_VALUE_ASSOC) {
                // Compute x coordinate from flat index (Fortran order)
                const x = i % xDim;
                const isLeft = x < midX;

                if (bitmap[i] === PEN_VALUE_PROJ) {
                    projCount++;
                    if (isLeft) projLeft++;
                    else projRight++;
                } else {
                    assocCount++;
                    if (isLeft) assocLeft++;
                    else assocRight++;
                }
            }
        }
        setProjVoxelCount(projCount);
        setAssocVoxelCount(assocCount);
        setProjLeftCount(projLeft);
        setProjRightCount(projRight);
        setAssocLeftCount(assocLeft);
        setAssocRightCount(assocRight);
    }, []);

    // Initialize NiiVue and load Color FA
    useEffect(() => {
        const initViewer = async () => {
            if (!canvasRef.current) return;
            if (!session?.session_id) {
                setLoadError('No session selected');
                setIsLoading(false);
                return;
            }

            // Fetch shell info (b-values + direction counts) and pick default
            let initialBValue: number | null = null;
            try {
                const shellRes = await fetch(`/sessions/${session.session_id}/shells`);
                if (shellRes.ok) {
                    const shellData = await shellRes.json();
                    const shells: { b_value: number; n_directions: number }[] = shellData.shells ?? [];
                    setShellInfo(shells);
                    if (shells.length > 0) {
                        initialBValue = shells.reduce((closest, s) =>
                            Math.abs(s.b_value - 1000) < Math.abs(closest.b_value - 1000) ? s : closest
                        ).b_value;
                        setSelectedBValue(initialBValue);
                    }
                }
            } catch { /* non-critical */ }

            const nv = new Niivue({
                show3Dcrosshair: false,
                crosshairWidth: 0,
                crosshairColor: [0, 0, 0, 0],
                backColor: [0, 0, 0, 1],
                dragAndDropEnabled: false,
                colorbarHeight: 0.0,
                dragMode: 0,
                textHeight: 0.04,  // Orientation label text size
                isOrientCube: true,  // Show 3D orientation cube in corner
            } as any);

            nv.attachToCanvas(canvasRef.current);
            nv.opts.isRadiologicalConvention = true;
            nvRef.current = nv;

            // Set up drawing colormap: 0=transparent, 1=blue (proj), 2=green (assoc)
            const drawColormap = {
                R: [0, 59, 34],      // Red values
                G: [0, 130, 197],    // Green values
                B: [0, 246, 94],     // Blue values
                A: [0, 180, 180],    // Alpha values (semi-transparent)
                labels: ['clear', 'SCR (Proj)', 'SLF (Assoc)']
            };

            try {
                const bvParam = initialBValue !== null ? `&b_value=${initialBValue}` : '';
                const url = `/sessions/${session.session_id}/compute_metric?metric=color_fa&save=false${bvParam}`;
                const res = await fetch(url);
                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.detail || 'Failed to load Color FA');
                }
                const data = await res.json();

                const fileUrl = `/files/viewer_cache/${data.output_filename}`;
                await nv.loadVolumes([{ url: fileUrl, name: data.output_filename }]);

                nv.setSliceType(nv.sliceTypeAxial);

                // Ensure all 4 orientation labels are visible (R/L on sides, A/P on top/bottom)
                if (typeof (nv as any).setCornerOrientationText === 'function') {
                    (nv as any).setCornerOrientationText(false);  // Labels on edges, not corners
                }

                const vol = nv.volumes[0] as any;
                if (vol && vol.dims) {
                    const zDim = vol.dims[3];
                    setDims([vol.dims[1], vol.dims[2], vol.dims[3]]);
                    setMaxSlice(zDim - 1);
                    sliceChangeFromSliderRef.current = true;
                    setCurrentSlice(Math.floor(zDim / 2));
                }

                // Initialize drawing layer
                (nv as any).createEmptyDrawing();
                (nv as any).setDrawColormap(drawColormap);
                (nv as any).setDrawOpacity(0.6);

                // Set up callback to update voxel counts after drawing
                (nv as any).onDrawingChanged = () => {
                    updateVoxelCounts();
                };

                // Try to load saved ROIs from the session
                try {
                    const savedRois = await getAlpsRois(session.session_id);
                    if (savedRois.has_rois && savedRois.mask_data && savedRois.dims) {
                        // Load the saved ROI mask into NiiVue's drawBitmap
                        const bitmap = (nv as any).drawBitmap;
                        if (bitmap && bitmap.length === savedRois.mask_data.length) {
                            for (let i = 0; i < savedRois.mask_data.length; i++) {
                                bitmap[i] = savedRois.mask_data[i];
                            }
                            // Refresh the display to show loaded ROIs
                            nv.refreshDrawing(true);
                            // Update voxel counts
                            updateVoxelCounts();
                            // Store metadata for display
                            if (savedRois.metadata) {
                                setSavedRoiMetadata(savedRois.metadata);
                                // Also set the FA threshold to match saved settings
                                if (savedRois.metadata.fa_threshold !== undefined) {
                                    setFaThreshold(savedRois.metadata.fa_threshold);
                                }
                                if (savedRois.metadata.fa_cap_percentile) {
                                    setUseFaCap(true);
                                    setFaCap(savedRois.metadata.fa_cap_percentile);
                                }
                                if (savedRois.metadata.hemisphere) {
                                    setHemisphere(savedRois.metadata.hemisphere as 'both' | 'left' | 'right');
                                }
                            }
                            console.log('Loaded saved ALPS ROIs from session');
                        }
                    }
                } catch (err) {
                    // Silently ignore - no saved ROIs is normal
                    console.log('No saved ROIs found or error loading:', err);
                }

                // Set up mouse move handler to show DEC values and sync slice
                nv.onLocationChange = (data: any) => {
                    if (data && data.vox && nv.volumes.length > 0) {
                        const vol = nv.volumes[0] as any;
                        const [x, y, z] = data.vox;

                        const xDim = vol.dims[1];
                        const yDim = vol.dims[2];
                        const zDim = vol.dims[3];

                        const xi = Math.round(x);
                        const yi = Math.round(y);
                        const zi = Math.max(0, Math.min(zDim - 1, Math.round(z)));

                        if (vol && vol.img && xi >= 0 && xi < xDim && yi >= 0 && yi < yDim && zi >= 0 && zi < zDim) {
                            const volSize = xDim * yDim * zDim;
                            const buffer = vol.img.buffer || vol.img;

                            // Apply permRAS to correct coordinate mapping
                            // permRAS: [-1, 2, 3] means X is flipped (negative sign)
                            let bufXi = xi;
                            if (vol.permRAS && vol.permRAS[0] < 0) {
                                bufXi = xDim - 1 - xi;
                            }

                            const view = new Uint8Array(buffer);
                            const bytesPerVoxel = Math.round(view.length / volSize) || 3;
                            const linearIdx = bufXi + yi * xDim + zi * xDim * yDim;
                            const idx = linearIdx * bytesPerVoxel;

                            const r = (idx + 2 < view.length) ? view[idx] : 0;
                            const g = (idx + 2 < view.length) ? view[idx + 1] : 0;
                            const b = (idx + 2 < view.length) ? view[idx + 2] : 0;

                            setCurrentSlice(zi);
                            setMouseDecValues({ r, g, b, x: xi, y: yi, z: zi });
                        }
                    }
                };

                setIsLoading(false);
            } catch (err: any) {
                setLoadError(err.message || 'Failed to load Color FA');
                setIsLoading(false);
            }
        };

        initViewer();
    }, [session?.session_id, updateVoxelCounts]);

    // Reload color FA when user changes the b-value shell
    const reloadColorFA = useCallback(async (bValue: number) => {
        const nv = nvRef.current;
        if (!nv || nv.volumes.length === 0) return;

        setIsReloadingColorFA(true);

        // Save current drawing bitmap
        const bitmap = (nv as any).drawBitmap;
        const savedBitmap = bitmap ? new Uint8Array(bitmap) : null;

        // Save current slice position
        const savedCrosshair = [...nv.scene.crosshairPos];

        try {
            const url = `/sessions/${session.session_id}/compute_metric?metric=color_fa&save=false&b_value=${bValue}`;
            const res = await fetch(url);
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.detail || 'Failed to reload Color FA');
            }
            const data = await res.json();

            // Close existing volumes before loading the new one
            while (nv.volumes.length > 0) {
                nv.removeVolume(nv.volumes[0]);
            }

            // Load new volume
            const fileUrl = `/files/viewer_cache/${data.output_filename}`;
            await nv.addVolumeFromUrl({ url: fileUrl, name: data.output_filename });

            nv.setSliceType(nv.sliceTypeAxial);

            // Restore drawing layer
            (nv as any).createEmptyDrawing();
            const drawColormap = {
                R: [0, 59, 34],
                G: [0, 130, 197],
                B: [0, 246, 94],
                A: [0, 180, 180],
                labels: ['clear', 'SCR (Proj)', 'SLF (Assoc)']
            };
            (nv as any).setDrawColormap(drawColormap);
            (nv as any).setDrawOpacity(0.6);

            // Restore saved bitmap
            if (savedBitmap) {
                const newBitmap = (nv as any).drawBitmap;
                if (newBitmap && newBitmap.length === savedBitmap.length) {
                    for (let i = 0; i < savedBitmap.length; i++) {
                        newBitmap[i] = savedBitmap[i];
                    }
                    nv.refreshDrawing(true);
                }
            }

            // Restore slice position
            nv.scene.crosshairPos = savedCrosshair as [number, number, number];
            nv.updateGLVolume();

            // Re-attach drawing changed callback
            (nv as any).onDrawingChanged = () => {
                updateVoxelCounts();
            };
        } catch (err: any) {
            console.error('Failed to reload color FA:', err);
            setLoadError(err.message || 'Failed to reload Color FA');
        } finally {
            setIsReloadingColorFA(false);
        }
    }, [session?.session_id, updateVoxelCounts]);

    // Update slice position - only when change came from slider, not from NiiVue scroll
    useEffect(() => {
        if (!nvRef.current || nvRef.current.volumes.length === 0) return;

        // Only update NiiVue position if the change came from the slider UI
        if (!sliceChangeFromSliderRef.current) {
            return; // Change came from NiiVue scroll, don't fight with it
        }
        sliceChangeFromSliderRef.current = false; // Reset flag

        const nv = nvRef.current;
        const vol = nv.volumes[0] as any;
        if (!vol || !vol.dims) return;

        const zDim = vol.dims[3];
        const frac = currentSlice / (zDim - 1);

        nv.scene.crosshairPos = [0.5, 0.5, frac];
        nv.updateGLVolume();
    }, [currentSlice]);

    // Update drawing mode when selection changes
    useEffect(() => {
        const nv = nvRef.current;
        if (!nv) return;

        if (drawingMode === 'proj') {
            (nv as any).setDrawingEnabled(true);
            (nv as any).setPenValue(PEN_VALUE_PROJ, false); // freehand
        } else if (drawingMode === 'proj-fill') {
            (nv as any).setDrawingEnabled(true);
            (nv as any).setPenValue(PEN_VALUE_PROJ, true); // flood fill
        } else if (drawingMode === 'assoc') {
            (nv as any).setDrawingEnabled(true);
            (nv as any).setPenValue(PEN_VALUE_ASSOC, false); // freehand
        } else if (drawingMode === 'assoc-fill') {
            (nv as any).setDrawingEnabled(true);
            (nv as any).setPenValue(PEN_VALUE_ASSOC, true); // flood fill
        } else if (drawingMode === 'erase') {
            (nv as any).setDrawingEnabled(true);
            (nv as any).setPenValue(PEN_VALUE_ERASE, false);
        } else {
            (nv as any).setDrawingEnabled(false);
        }
    }, [drawingMode]);

    // Poll for voxel count updates when drawing is enabled
    useEffect(() => {
        if (!drawingMode) return;

        // Update counts periodically while drawing
        const interval = setInterval(() => {
            updateVoxelCounts();
        }, 500);

        return () => clearInterval(interval);
    }, [drawingMode, updateVoxelCounts]);

    // Also update counts on mouse up anywhere (drawing finished)
    useEffect(() => {
        const handleMouseUp = () => {
            if (drawingMode) {
                // Small delay to let NiiVue finish updating
                setTimeout(updateVoxelCounts, 100);
            }
        };

        window.addEventListener('mouseup', handleMouseUp);
        return () => window.removeEventListener('mouseup', handleMouseUp);
    }, [drawingMode, updateVoxelCounts]);

    // Clear all drawings
    const clearDrawings = useCallback(() => {
        const nv = nvRef.current;
        if (!nv) return;

        (nv as any).createEmptyDrawing();
        (nv as any).refreshDrawing();
        updateVoxelCounts();
    }, [updateVoxelCounts]);

    // Clear specific ROI
    const clearROI = useCallback((roiValue: number) => {
        const nv = nvRef.current;
        if (!nv) return;

        const bitmap = (nv as any).drawBitmap;
        if (!bitmap) return;

        for (let i = 0; i < bitmap.length; i++) {
            if (bitmap[i] === roiValue) {
                bitmap[i] = 0;
            }
        }
        (nv as any).refreshDrawing();
        updateVoxelCounts();
    }, [updateVoxelCounts]);

    // Undo last drawing
    const undoDrawing = useCallback(() => {
        const nv = nvRef.current;
        if (!nv) return;

        (nv as any).drawUndo();
        updateVoxelCounts();
    }, [updateVoxelCounts]);

    // Compute ALPS using the mask endpoint
    const computeALPS = async () => {
        if (projVoxelCount === 0 || assocVoxelCount === 0) {
            setComputeError('Please draw both ROIs (SCR and SLF)');
            return;
        }

        const nv = nvRef.current;
        if (!nv) {
            setComputeError('Viewer not initialized');
            return;
        }

        const bitmap = (nv as any).drawBitmap;
        if (!bitmap) {
            setComputeError('No drawing data available');
            return;
        }

        setIsComputing(true);
        setComputeError(null);

        try {
            // Send the raw bitmap to the mask endpoint
            const requestBody = {
                mask_data: Array.from(bitmap),
                dims: [dims[0], dims[1], dims[2]],
                pen_proj: PEN_VALUE_PROJ,
                pen_assoc: PEN_VALUE_ASSOC,
                fa_threshold: faThreshold,
                fa_cap_percentile: useFaCap ? faCap : null,
                hemisphere: hemisphere,
                method: 'all',
                b_value: selectedBValue
            };

            const res = await fetch(`/sessions/${session.session_id}/compute_alps_mask`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.detail || 'ALPS computation failed');
            }

            const results: ALPSResults = await res.json();
            setAlpsResults(results);
        } catch (err: any) {
            setComputeError(err.message || 'ALPS computation failed');
        } finally {
            setIsComputing(false);
        }
    };

    // Export results
    const exportResults = () => {
        if (!alpsResults) return;

        const blob = new Blob([JSON.stringify(alpsResults, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `alps_results_${session.session_id}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Load previous ALPS results
    const loadPreviousResults = async () => {
        console.log('loadPreviousResults called');
        setComputeError(null);

        try {
            // Load saved ALPS results
            console.log('Fetching ALPS results for session:', session.session_id);
            const savedResults = await getAlpsResults(session.session_id);
            console.log('Received saved results:', savedResults);

            if (!savedResults.has_results) {
                setComputeError(savedResults.message || 'No previous results found');
                return;
            }

            // Convert the saved results format to the ALPSResults format expected by the UI
            const saved = savedResults.alps_results!;
            const convertedResults: ALPSResults = {
                session_id: session.session_id,
                method: 'all',
                fa_threshold: saved.fa_threshold,
                hemisphere: saved.hemisphere,
                roi_proj: { type: 'mask', pen_value: 1 },
                roi_assoc: { type: 'mask', pen_value: 2 }
            };

            // Add per-hemisphere results if available
            if (saved.left) {
                convertedResults.left = {
                    hemisphere: 'left',
                    roi_stats: {
                        proj_voxels: 0,
                        assoc_voxels: 0,
                        proj_mean_fa: 0,
                        assoc_mean_fa: 0
                    },
                    classic: saved.left.classic != null ? { alps_index: saved.left.classic } as any : undefined,
                    orientation_aware: saved.left.refined != null ? { alps_index: saved.left.refined } as any : undefined,
                    refined_local: saved.left.refined_plus != null ? { alps_index: saved.left.refined_plus } as any : undefined,
                    alps_pas: saved.left.alps_pas != null ? { alps_index: saved.left.alps_pas } as any : undefined,
                };
            }

            if (saved.right) {
                convertedResults.right = {
                    hemisphere: 'right',
                    roi_stats: {
                        proj_voxels: 0,
                        assoc_voxels: 0,
                        proj_mean_fa: 0,
                        assoc_mean_fa: 0
                    },
                    classic: saved.right.classic != null ? { alps_index: saved.right.classic } as any : undefined,
                    orientation_aware: saved.right.refined != null ? { alps_index: saved.right.refined } as any : undefined,
                    refined_local: saved.right.refined_plus != null ? { alps_index: saved.right.refined_plus } as any : undefined,
                    alps_pas: saved.right.alps_pas != null ? { alps_index: saved.right.alps_pas } as any : undefined,
                };
            }

            // Add top-level results for backwards compatibility
            if (saved.classic != null) {
                convertedResults.classic = { alps_index: saved.classic } as any;
            }
            if (saved.refined != null) {
                convertedResults.orientation_aware = { alps_index: saved.refined } as any;
            }
            if (saved.refined_plus != null) {
                convertedResults.refined_local = { alps_index: saved.refined_plus } as any;
            }
            if (saved.alps_pas != null) {
                convertedResults.alps_pas = { alps_index: saved.alps_pas } as any;
            }

            console.log('Setting ALPS results:', convertedResults);
            setAlpsResults(convertedResults);

            // Also try to load the saved ROI mask
            const nv = nvRef.current;
            if (nv) {
                try {
                    console.log('Loading saved ROI mask...');
                    const roiData = await getAlpsRois(session.session_id);
                    console.log('ROI data received:', roiData);

                    if (roiData.has_rois && roiData.mask_data && roiData.dims) {
                        const bitmap = (nv as any).drawBitmap;
                        console.log('Bitmap length:', bitmap?.length, 'Mask data length:', roiData.mask_data.length);

                        if (bitmap && bitmap.length === roiData.mask_data.length) {
                            // Copy data into existing bitmap (don't replace the array)
                            for (let i = 0; i < roiData.mask_data.length; i++) {
                                bitmap[i] = roiData.mask_data[i];
                            }
                            // Refresh the NiiVue display
                            console.log('Refreshing NiiVue display...');
                            nv.refreshDrawing(true);
                            // Update voxel counts
                            updateVoxelCounts();
                            // Clear any shape-mode ROIs
                            setShapes([]);
                            console.log('Successfully loaded ALPS ROIs');
                        } else {
                            console.warn('Bitmap length mismatch');
                        }
                    }
                } catch (err) {
                    console.error('Error loading ROIs:', err);
                }
            }
        } catch (err: any) {
            console.error('Error in loadPreviousResults:', err);
            setComputeError(err.message || 'Failed to load previous results');
        }
    };

    // Run rotation simulation
    const runSimulation = async () => {
        if (projVoxelCount === 0 || assocVoxelCount === 0) {
            setSimulationError('Please draw both ROIs (SCR and SLF)');
            return;
        }

        const nv = nvRef.current;
        if (!nv) {
            setSimulationError('Viewer not initialized');
            return;
        }

        const bitmap = (nv as any).drawBitmap;
        if (!bitmap) {
            setSimulationError('No drawing data available');
            return;
        }

        setIsSimulating(true);
        setSimulationError(null);

        try {
            const requestBody = {
                mask_data: Array.from(bitmap),
                dims: [dims[0], dims[1], dims[2]],
                pen_proj: PEN_VALUE_PROJ,
                pen_assoc: PEN_VALUE_ASSOC,
                fa_threshold: faThreshold,
                rotation_axis: rotationAxis,
                angle_range: angleRange,
                angle_step: 5.0,
                hemisphere: simHemisphere
            };

            const res = await fetch(`/sessions/${session.session_id}/simulate_alps_rotation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.detail || 'Simulation failed');
            }

            const results: SimulationResult = await res.json();
            setSimulationResult(results);
            setShowSimulation(true);
        } catch (err: any) {
            setSimulationError(err.message || 'Simulation failed');
        } finally {
            setIsSimulating(false);
        }
    };

    // Generate Auto ROIs using JHU atlas
    const generateAutoROIs = async (method: 'cubic' | 'eigenvector' | 'elongated' = 'cubic') => {
        const nv = nvRef.current;
        if (!nv) {
            setAutoROIError('Viewer not initialized');
            return;
        }

        setIsGeneratingAutoROI(true);
        setAutoROIError(null);
        setAutoROIInfo(null);

        try {
            // Call the backend to generate auto ROIs
            const res = await fetch(`/sessions/${session.session_id}/auto_alps_rois`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    fa_threshold: faThreshold,
                    use_nonlinear: registrationQuality !== 'fast',
                    fnirt_preset: registrationQuality === 'fine' ? 'fine' : 'standard',
                    restrict_to_slice: true,
                    force_redownload: false,
                    method: method,
                    direction_threshold: 0.7
                })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.detail || 'Failed to generate auto ROIs');
            }

            const result = await res.json();

            // Now load the combined mask and apply it to the drawing
            const maskUrl = `/sessions/${session.session_id}/auto_alps_roi_mask/combined`;
            const maskRes = await fetch(maskUrl);
            if (!maskRes.ok) {
                throw new Error('Failed to load auto ROI mask');
            }

            // Load mask as NIfTI and apply to drawing bitmap
            const maskBlob = await maskRes.blob();
            const maskArrayBuffer = await maskBlob.arrayBuffer();

            // Parse the NIfTI (we need to decompress gzip first)
            const pako = await import('pako');
            const decompressed = pako.inflate(new Uint8Array(maskArrayBuffer));

            // Parse NIfTI header to get dimensions and data offset
            const headerView = new DataView(decompressed.buffer);
            const sizeof_hdr = headerView.getInt32(0, true);

            if (sizeof_hdr !== 348) {
                throw new Error('Invalid NIfTI header');
            }

            // Get dimensions
            const dim1 = headerView.getInt16(42, true);
            const dim2 = headerView.getInt16(44, true);
            const dim3 = headerView.getInt16(46, true);

            // Get data offset (datatype at offset 70 is uint8=2 for our mask)
            const vox_offset = headerView.getFloat32(108, true);

            // Extract mask data (assuming uint8 datatype = 2)
            const dataOffset = Math.round(vox_offset);
            const numVoxels = dim1 * dim2 * dim3;
            const maskData = new Uint8Array(decompressed.buffer, dataOffset, numVoxels);

            // Apply to drawing bitmap
            const bitmap = (nv as any).drawBitmap;
            if (!bitmap || bitmap.length !== maskData.length) {
                throw new Error(`Bitmap size mismatch: bitmap=${bitmap?.length}, mask=${maskData.length}`);
            }

            // Verify dimensions match NiiVue volume
            const nvVol = nv.volumes[0] as any;
            console.log(`Mask NIfTI dims: ${dim1}x${dim2}x${dim3}, NiiVue vol dims: ${nvVol.dims[1]}x${nvVol.dims[2]}x${nvVol.dims[3]}`);

            // Log mask statistics before applying (fast single pass)
            let maskProjCount = 0, maskAssocCount = 0;
            for (let i = 0; i < maskData.length; i++) {
                if (maskData[i] === 1) maskProjCount++;
                else if (maskData[i] === 2) maskAssocCount++;
            }
            console.log(`Mask loaded: ${dim1}x${dim2}x${dim3}, proj=${maskProjCount}, assoc=${maskAssocCount}`);

            // Clear existing drawing and apply mask with X-flip for permRAS
            // NiiVue's drawBitmap uses display coordinates, which have X flipped due to permRAS
            console.time('applyMask');
            const nvVol2 = nv.volumes[0] as any;
            const xFlipped = nvVol2.permRAS && nvVol2.permRAS[0] < 0;
            console.log(`X-flipped: ${xFlipped}`);

            if (xFlipped) {
                // Need to flip X axis - process row by row for efficiency
                const sliceSize = dim1 * dim2;
                for (let z = 0; z < dim3; z++) {
                    const zOffset = z * sliceSize;
                    for (let y = 0; y < dim2; y++) {
                        const rowOffset = zOffset + y * dim1;
                        for (let x = 0; x < dim1; x++) {
                            bitmap[rowOffset + (dim1 - 1 - x)] = maskData[rowOffset + x];
                        }
                    }
                }
            } else {
                // No flip needed - direct copy
                bitmap.set(maskData);
            }
            console.timeEnd('applyMask');

            // Refresh the drawing - use requestAnimationFrame to avoid blocking
            requestAnimationFrame(() => {
                (nv as any).refreshDrawing();
                updateVoxelCounts();
            });

            // Navigate to the optimal slice
            if (result.z_slice !== null && result.z_slice !== undefined) {
                sliceChangeFromSliderRef.current = true;
                setCurrentSlice(result.z_slice);
            }

            // Store info for display
            setAutoROIInfo({
                voxelCounts: result.voxel_counts,
                zSlice: result.z_slice
            });

            // Store ROI centers and method for cubic ROIs (allows movement)
            console.log('Auto ROI result:', result);
            console.log('Setting autoROIMethod to:', method);
            setAutoROIMethod(method);
            if (result.roi_centers) {
                console.log('Setting roiCenters:', result.roi_centers);
                setRoiCenters({
                    proj_L: result.roi_centers.proj_L,
                    proj_R: result.roi_centers.proj_R,
                    assoc_L: result.roi_centers.assoc_L,
                    assoc_R: result.roi_centers.assoc_R
                });
            } else {
                console.log('No roi_centers in result');
            }
            if (result.roi_size_voxels) {
                console.log('Setting roiSizeVoxels:', result.roi_size_voxels);
                setRoiSizeVoxels(result.roi_size_voxels);
            } else {
                console.log('No roi_size_voxels in result');
            }

        } catch (err: any) {
            console.error('Auto ROI generation error:', err);
            setAutoROIError(err.message || 'Failed to generate auto ROIs');
        } finally {
            setIsGeneratingAutoROI(false);
        }
    };

    // Move a cubic ROI in-plane
    const moveROI = useCallback((roiKey: 'proj_L' | 'proj_R' | 'assoc_L' | 'assoc_R', dx: number, dy: number) => {
        if (!roiCenters || !roiSizeVoxels || autoROIMethod !== 'cubic') return;

        const nv = nvRef.current;
        if (!nv) return;

        const center = roiCenters[roiKey];
        if (!center) return;

        const vol = nv.volumes[0] as any;
        if (!vol || !vol.dims) return;

        const [xDim, yDim, zDim] = [vol.dims[1], vol.dims[2], vol.dims[3]];

        // Calculate new center (in-plane movement only)
        const newCenter: [number, number, number] = [
            Math.max(0, Math.min(xDim - 1, center[0] + dx)),
            Math.max(0, Math.min(yDim - 1, center[1] + dy)),
            center[2] // Keep z the same
        ];

        // Update state
        const newCenters = { ...roiCenters, [roiKey]: newCenter };
        setRoiCenters(newCenters);

        // Redraw the ROIs
        const bitmap = (nv as any).drawBitmap;
        if (!bitmap) return;

        const penValue = roiKey.startsWith('proj') ? PEN_VALUE_PROJ : PEN_VALUE_ASSOC;
        const halfSize = roiSizeVoxels.map(s => Math.floor(s / 2));

        // Clear all ROIs of this type (proj or assoc) and redraw with new positions
        for (let i = 0; i < bitmap.length; i++) {
            if (bitmap[i] === penValue) {
                bitmap[i] = 0;
            }
        }

        // Redraw all ROIs of this type with updated centers
        const nvVol = nv.volumes[0] as any;
        const xFlipped = nvVol.permRAS && nvVol.permRAS[0] < 0;

        const drawCube = (cx: number, cy: number, cz: number, pen: number) => {
            const [hx, hy] = halfSize;
            // Use roiNumSlices to control z extent: 1 slice = just center, 2 slices = center +/- 1
            const hz = roiNumSlices === 1 ? 0 : Math.floor((roiNumSlices - 1) / 2);
            for (let dz = -hz; dz <= hz; dz++) {
                for (let dy = -hy; dy <= hy; dy++) {
                    for (let ddx = -hx; ddx <= hx; ddx++) {
                        const x = cx + ddx;
                        const y = cy + dy;
                        const z = cz + dz;
                        if (x >= 0 && x < xDim && y >= 0 && y < yDim && z >= 0 && z < zDim) {
                            const dstX = xFlipped ? (xDim - 1 - x) : x;
                            const idx = dstX + y * xDim + z * xDim * yDim;
                            bitmap[idx] = pen;
                        }
                    }
                }
            }
        };

        // Redraw both ROIs of this type (L and R)
        if (roiKey.startsWith('proj')) {
            if (newCenters.proj_L) drawCube(newCenters.proj_L[0], newCenters.proj_L[1], newCenters.proj_L[2], PEN_VALUE_PROJ);
            if (newCenters.proj_R) drawCube(newCenters.proj_R[0], newCenters.proj_R[1], newCenters.proj_R[2], PEN_VALUE_PROJ);
        } else {
            if (newCenters.assoc_L) drawCube(newCenters.assoc_L[0], newCenters.assoc_L[1], newCenters.assoc_L[2], PEN_VALUE_ASSOC);
            if (newCenters.assoc_R) drawCube(newCenters.assoc_R[0], newCenters.assoc_R[1], newCenters.assoc_R[2], PEN_VALUE_ASSOC);
        }

        (nv as any).refreshDrawing();
        updateVoxelCounts();
    }, [roiCenters, roiSizeVoxels, autoROIMethod, roiNumSlices, updateVoxelCounts]);

    // Redraw all cubic ROIs (used when roiNumSlices changes)
    const redrawAllCubicROIs = useCallback(() => {
        if (!roiCenters || !roiSizeVoxels || autoROIMethod !== 'cubic') return;

        const nv = nvRef.current;
        if (!nv) return;

        const vol = nv.volumes[0] as any;
        if (!vol || !vol.dims) return;

        const [xDim, yDim, zDim] = [vol.dims[1], vol.dims[2], vol.dims[3]];
        const bitmap = (nv as any).drawBitmap;
        if (!bitmap) return;

        const halfSize = roiSizeVoxels.map(s => Math.floor(s / 2));
        const xFlipped = vol.permRAS && vol.permRAS[0] < 0;

        // Clear all ROIs
        for (let i = 0; i < bitmap.length; i++) {
            if (bitmap[i] === PEN_VALUE_PROJ || bitmap[i] === PEN_VALUE_ASSOC) {
                bitmap[i] = 0;
            }
        }

        const drawCube = (cx: number, cy: number, cz: number, pen: number) => {
            const [hx, hy] = halfSize;
            const hz = roiNumSlices === 1 ? 0 : Math.floor((roiNumSlices - 1) / 2);
            for (let dz = -hz; dz <= hz; dz++) {
                for (let dy = -hy; dy <= hy; dy++) {
                    for (let ddx = -hx; ddx <= hx; ddx++) {
                        const x = cx + ddx;
                        const y = cy + dy;
                        const z = cz + dz;
                        if (x >= 0 && x < xDim && y >= 0 && y < yDim && z >= 0 && z < zDim) {
                            const dstX = xFlipped ? (xDim - 1 - x) : x;
                            const idx = dstX + y * xDim + z * xDim * yDim;
                            bitmap[idx] = pen;
                        }
                    }
                }
            }
        };

        // Redraw all ROIs
        if (roiCenters.proj_L) drawCube(roiCenters.proj_L[0], roiCenters.proj_L[1], roiCenters.proj_L[2], PEN_VALUE_PROJ);
        if (roiCenters.proj_R) drawCube(roiCenters.proj_R[0], roiCenters.proj_R[1], roiCenters.proj_R[2], PEN_VALUE_PROJ);
        if (roiCenters.assoc_L) drawCube(roiCenters.assoc_L[0], roiCenters.assoc_L[1], roiCenters.assoc_L[2], PEN_VALUE_ASSOC);
        if (roiCenters.assoc_R) drawCube(roiCenters.assoc_R[0], roiCenters.assoc_R[1], roiCenters.assoc_R[2], PEN_VALUE_ASSOC);

        (nv as any).refreshDrawing();
        updateVoxelCounts();
    }, [roiCenters, roiSizeVoxels, autoROIMethod, roiNumSlices, updateVoxelCounts]);

    // Effect to redraw ROIs when slice count changes
    useEffect(() => {
        redrawAllCubicROIs();
    }, [roiNumSlices, redrawAllCubicROIs]);

    // Resize all cubic ROIs
    const resizeROIs = useCallback((delta: number) => {
        if (!roiCenters || !roiSizeVoxels || autoROIMethod !== 'cubic') return;

        const nv = nvRef.current;
        if (!nv) return;

        // Calculate new size (minimum 1x1, maximum 15x15)
        const newSize: [number, number, number] = [
            Math.max(1, Math.min(15, roiSizeVoxels[0] + delta)),
            Math.max(1, Math.min(15, roiSizeVoxels[1] + delta)),
            roiSizeVoxels[2] // Keep z size unchanged (controlled by roiNumSlices)
        ];

        setRoiSizeVoxels(newSize);
    }, [roiCenters, roiSizeVoxels, autoROIMethod]);

    // Effect to redraw ROIs when size changes
    useEffect(() => {
        redrawAllCubicROIs();
    }, [roiSizeVoxels, redrawAllCubicROIs]);

    // ==================== SHAPE-BASED ROI SYSTEM ====================

    // Coordinate transformation: bitmap voxel to canvas pixels
    // Uses clientWidth/clientHeight since that's what mouse events use
    const voxelToCanvas = useCallback((vx: number, vy: number): [number, number] | null => {
        const nv = nvRef.current;
        const canvas = canvasRef.current;
        if (!nv || !canvas || !nv.volumes[0]) return null;

        const vol = nv.volumes[0] as any;
        const [xDim, yDim] = [vol.dims[1], vol.dims[2]];

        // Use clientWidth/Height since mouse events are in CSS pixels
        const canvasW = canvas.clientWidth;
        const canvasH = canvas.clientHeight;

        // NiiVue renders the image to fill the canvas while maintaining aspect ratio
        const aspectRatio = xDim / yDim;
        let renderW: number, renderH: number, offsetX: number, offsetY: number;

        if (canvasW / canvasH > aspectRatio) {
            renderH = canvasH;
            renderW = renderH * aspectRatio;
            offsetX = (canvasW - renderW) / 2;
            offsetY = 0;
        } else {
            renderW = canvasW;
            renderH = renderW / aspectRatio;
            offsetX = 0;
            offsetY = (canvasH - renderH) / 2;
        }

        // Simple linear mapping - bitmap X=0 maps to canvas left edge
        const cx = offsetX + (vx / (xDim - 1)) * renderW;
        const cy = offsetY + ((yDim - 1 - vy) / (yDim - 1)) * renderH; // Y flipped for canvas coords

        return [cx, cy];
    }, []);

    // Coordinate transformation: canvas pixels to bitmap voxel
    const canvasToVoxel = useCallback((cx: number, cy: number): [number, number] | null => {
        const nv = nvRef.current;
        const canvas = canvasRef.current;
        if (!nv || !canvas || !nv.volumes[0]) return null;

        const vol = nv.volumes[0] as any;
        const [xDim, yDim] = [vol.dims[1], vol.dims[2]];

        // Use clientWidth/Height since mouse events are in CSS pixels
        const canvasW = canvas.clientWidth;
        const canvasH = canvas.clientHeight;

        const aspectRatio = xDim / yDim;
        let renderW: number, renderH: number, offsetX: number, offsetY: number;

        if (canvasW / canvasH > aspectRatio) {
            renderH = canvasH;
            renderW = renderH * aspectRatio;
            offsetX = (canvasW - renderW) / 2;
            offsetY = 0;
        } else {
            renderW = canvasW;
            renderH = renderW / aspectRatio;
            offsetX = 0;
            offsetY = (canvasH - renderH) / 2;
        }

        // Check if click is within rendered image
        if (cx < offsetX || cx > offsetX + renderW || cy < offsetY || cy > offsetY + renderH) {
            return null;
        }

        // Simple linear mapping - canvas left edge maps to bitmap X=0
        const vx = ((cx - offsetX) / renderW) * (xDim - 1);
        const vy = (yDim - 1) - ((cy - offsetY) / renderH) * (yDim - 1); // Flip Y back

        return [Math.round(vx), Math.round(vy)];
    }, []);

    // Get scale factor (pixels per voxel)
    const getPixelsPerVoxel = useCallback((): number => {
        const nv = nvRef.current;
        const canvas = canvasRef.current;
        if (!nv || !canvas || !nv.volumes[0]) return 1;

        const vol = nv.volumes[0] as any;
        const [xDim, yDim] = [vol.dims[1], vol.dims[2]];

        // Use clientWidth/Height since mouse events are in CSS pixels
        const canvasW = canvas.clientWidth;
        const canvasH = canvas.clientHeight;

        const aspectRatio = xDim / yDim;
        let renderW: number;

        if (canvasW / canvasH > aspectRatio) {
            const renderH = canvasH;
            renderW = renderH * aspectRatio;
        } else {
            renderW = canvasW;
        }

        return renderW / xDim;
    }, []);

    // Hit test: check if point is near a handle
    const hitTestHandle = useCallback((cx: number, cy: number, shape: ShapeROI): HandleType => {
        const ppv = getPixelsPerVoxel();
        const handleSize = 8; // pixels
        const rotateHandleDist = 25; // pixels from top edge

        const centerCanvas = voxelToCanvas(shape.center[0], shape.center[1]);
        if (!centerCanvas) return null;

        const [ccx, ccy] = centerCanvas;
        const hwPx = shape.size[0] * ppv;
        const hhPx = shape.size[1] * ppv;

        // Apply rotation transform for corner positions
        const rot = (shape.rotation * Math.PI) / 180;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);

        // Helper to rotate a point around center
        const rotatePoint = (dx: number, dy: number): [number, number] => {
            return [
                ccx + dx * cos - dy * sin,
                ccy + dx * sin + dy * cos
            ];
        };

        // Check distance to a point
        const near = (px: number, py: number): boolean => {
            const dist = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
            return dist < handleSize;
        };

        // Corner handles (in rotated space)
        const nw = rotatePoint(-hwPx, -hhPx);
        const ne = rotatePoint(hwPx, -hhPx);
        const sw = rotatePoint(-hwPx, hhPx);
        const se = rotatePoint(hwPx, hhPx);

        if (near(nw[0], nw[1])) return 'nw';
        if (near(ne[0], ne[1])) return 'ne';
        if (near(sw[0], sw[1])) return 'sw';
        if (near(se[0], se[1])) return 'se';

        // Edge handles
        const n = rotatePoint(0, -hhPx);
        const s = rotatePoint(0, hhPx);
        const e = rotatePoint(hwPx, 0);
        const w = rotatePoint(-hwPx, 0);

        if (near(n[0], n[1])) return 'n';
        if (near(s[0], s[1])) return 's';
        if (near(e[0], e[1])) return 'e';
        if (near(w[0], w[1])) return 'w';

        // Rotation handle (above top edge)
        const rotHandle = rotatePoint(0, -hhPx - rotateHandleDist);
        if (near(rotHandle[0], rotHandle[1])) return 'rotate';

        // Center handle (for move)
        if (near(ccx, ccy)) return 'center';

        return null;
    }, [voxelToCanvas, getPixelsPerVoxel]);

    // Check if point is inside shape (for selection)
    const isPointInShape = useCallback((cx: number, cy: number, shape: ShapeROI): boolean => {
        const centerCanvas = voxelToCanvas(shape.center[0], shape.center[1]);
        if (!centerCanvas) return false;

        const ppv = getPixelsPerVoxel();
        const [ccx, ccy] = centerCanvas;
        const hwPx = shape.size[0] * ppv;
        const hhPx = shape.size[1] * ppv;

        // Transform point to shape's local coordinate system (undo rotation)
        const rot = (-shape.rotation * Math.PI) / 180;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const dx = cx - ccx;
        const dy = cy - ccy;
        const localX = dx * cos - dy * sin;
        const localY = dx * sin + dy * cos;

        if (shape.type === 'rectangle') {
            return Math.abs(localX) <= hwPx && Math.abs(localY) <= hhPx;
        } else {
            // Ellipse: (x/a)^2 + (y/b)^2 <= 1
            return (localX / hwPx) ** 2 + (localY / hhPx) ** 2 <= 1;
        }
    }, [voxelToCanvas, getPixelsPerVoxel]);

    // Find shape and handle at point
    const findShapeAtPoint = useCallback((cx: number, cy: number): { shapeId: string; handle: HandleType } | null => {
        // Check shapes on current slice, in reverse order (top-most first)
        const currentShapes = shapes.filter(s => s.zSlice === currentSlice);
        for (let i = currentShapes.length - 1; i >= 0; i--) {
            const shape = currentShapes[i];
            const handle = hitTestHandle(cx, cy, shape);
            if (handle) {
                return { shapeId: shape.id, handle };
            }
            if (isPointInShape(cx, cy, shape)) {
                return { shapeId: shape.id, handle: 'center' };
            }
        }
        return null;
    }, [shapes, currentSlice, hitTestHandle, isPointInShape]);

    // Render overlay canvas
    const renderOverlay = useCallback(() => {
        const canvas = overlayCanvasRef.current;
        const nvCanvas = canvasRef.current;
        if (!canvas || !nvCanvas) return;

        // Sync canvas size to match CSS size (for sharp rendering)
        const dpr = window.devicePixelRatio || 1;
        const cssWidth = nvCanvas.clientWidth;
        const cssHeight = nvCanvas.clientHeight;

        if (canvas.width !== cssWidth * dpr || canvas.height !== cssHeight * dpr) {
            canvas.width = cssWidth * dpr;
            canvas.height = cssHeight * dpr;
            canvas.style.width = cssWidth + 'px';
            canvas.style.height = cssHeight + 'px';
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Scale for device pixel ratio
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssWidth, cssHeight);

        const ppv = getPixelsPerVoxel();
        const handleSize = 6;
        const rotateHandleDist = 25;

        // Draw shapes on current slice
        const currentShapes = shapes.filter(s => s.zSlice === currentSlice);

        for (const shape of currentShapes) {
            const centerCanvas = voxelToCanvas(shape.center[0], shape.center[1]);
            if (!centerCanvas) continue;

            const [ccx, ccy] = centerCanvas;
            const hwPx = shape.size[0] * ppv;
            const hhPx = shape.size[1] * ppv;
            const isSelected = shape.id === selectedShapeId;

            // Set colors based on ROI type
            const strokeColor = shape.roiType === 'proj' ? '#3b82f6' : '#22c55e'; // Blue or green
            const fillColor = shape.roiType === 'proj' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(34, 197, 94, 0.2)';

            ctx.save();
            ctx.translate(ccx, ccy);
            ctx.rotate((shape.rotation * Math.PI) / 180);

            // Draw shape
            ctx.beginPath();
            if (shape.type === 'rectangle') {
                ctx.rect(-hwPx, -hhPx, hwPx * 2, hhPx * 2);
            } else {
                ctx.ellipse(0, 0, hwPx, hhPx, 0, 0, Math.PI * 2);
            }
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = isSelected ? 2 : 1;
            ctx.stroke();

            // Draw handles if selected
            if (isSelected) {
                ctx.fillStyle = strokeColor;

                // Corner handles
                const corners = [[-hwPx, -hhPx], [hwPx, -hhPx], [-hwPx, hhPx], [hwPx, hhPx]];
                for (const [hx, hy] of corners) {
                    ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
                }

                // Edge handles
                const edges = [[0, -hhPx], [0, hhPx], [-hwPx, 0], [hwPx, 0]];
                for (const [hx, hy] of edges) {
                    ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
                }

                // Center handle
                ctx.beginPath();
                ctx.arc(0, 0, handleSize / 2, 0, Math.PI * 2);
                ctx.fill();

                // Rotation handle and line
                ctx.beginPath();
                ctx.moveTo(0, -hhPx);
                ctx.lineTo(0, -hhPx - rotateHandleDist);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(0, -hhPx - rotateHandleDist, handleSize / 2 + 2, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        }
    }, [shapes, currentSlice, selectedShapeId, voxelToCanvas, getPixelsPerVoxel]);

    // Write shape to bitmap
    // Shape coordinates are in CANVAS space (where user clicked/dragged)
    // Need to flip X because NiiVue renders bitmap with X flipped (permRAS)
    const writeShapeToBitmap = useCallback((shape: ShapeROI) => {
        const nv = nvRef.current;
        if (!nv) return;

        const bitmap = (nv as any).drawBitmap;
        if (!bitmap) return;

        const vol = nv.volumes[0] as any;
        if (!vol || !vol.dims) return;

        const [xDim, yDim] = [vol.dims[1], vol.dims[2]];
        const xFlipped = vol.permRAS && vol.permRAS[0] < 0;
        const pen = shape.roiType === 'proj' ? PEN_VALUE_PROJ : PEN_VALUE_ASSOC;

        const [cx, cy] = shape.center;
        const [hx, hy] = shape.size;
        const z = shape.zSlice;
        // Negate rotation because voxel space has Y-up while canvas has Y-down
        // This flips the rotation direction to match the visual
        const rot = (-shape.rotation * Math.PI) / 180;
        const cos = Math.cos(-rot); // Negative for inverse transform
        const sin = Math.sin(-rot);

        // Iterate over bounding box
        for (let dy = -Math.ceil(hy) - 1; dy <= Math.ceil(hy) + 1; dy++) {
            for (let dx = -Math.ceil(hx) - 1; dx <= Math.ceil(hx) + 1; dx++) {
                const vx = Math.round(cx + dx);
                const vy = Math.round(cy + dy);

                if (vx < 0 || vx >= xDim || vy < 0 || vy >= yDim) continue;

                // Transform to shape's local coordinates
                const localX = dx * cos - dy * sin;
                const localY = dx * sin + dy * cos;

                let inside = false;
                if (shape.type === 'rectangle') {
                    inside = Math.abs(localX) <= hx && Math.abs(localY) <= hy;
                } else {
                    // Ellipse
                    inside = (localX / hx) ** 2 + (localY / hy) ** 2 <= 1;
                }

                if (inside) {
                    // Flip X for bitmap if needed (NiiVue renders with X flipped)
                    const bitmapX = xFlipped ? (xDim - 1 - vx) : vx;
                    const idx = bitmapX + vy * xDim + z * xDim * yDim;
                    bitmap[idx] = pen;
                }
            }
        }
    }, []);

    // Write all shapes to bitmap
    const writeAllShapesToBitmap = useCallback(() => {
        const nv = nvRef.current;
        if (!nv) return;

        // Clear bitmap first
        const bitmap = (nv as any).drawBitmap;
        if (bitmap) {
            for (let i = 0; i < bitmap.length; i++) {
                bitmap[i] = 0;
            }
        }

        // Write each shape
        for (const shape of shapes) {
            writeShapeToBitmap(shape);
        }

        (nv as any).refreshDrawing();
        updateVoxelCounts();
    }, [shapes, writeShapeToBitmap, updateVoxelCounts]);

    // Mouse handlers for overlay canvas
    const handleOverlayMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isShapeMode) return;

        const canvas = overlayCanvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        // Check if clicking on existing shape
        const hit = findShapeAtPoint(cx, cy);

        if (hit) {
            // Start dragging existing shape
            const shape = shapes.find(s => s.id === hit.shapeId);
            if (shape) {
                setSelectedShapeId(hit.shapeId);
                const mode = hit.handle === 'center' ? 'move' :
                            hit.handle === 'rotate' ? 'rotate' : 'resize';
                setDragState({
                    mode,
                    shapeId: hit.shapeId,
                    handle: hit.handle,
                    startPos: [cx, cy],
                    startVoxel: canvasToVoxel(cx, cy) || [0, 0],
                    startShape: { ...shape }
                });
            }
        } else {
            // Start creating new shape
            const voxel = canvasToVoxel(cx, cy);
            if (voxel) {
                const newShape: ShapeROI = {
                    id: `shape-${Date.now()}`,
                    type: shapeType,
                    roiType: shapeRoiType,
                    center: voxel,
                    size: [0.5, 0.5], // Start with minimal size
                    zSlice: currentSlice,
                    rotation: 0
                };
                setShapes(prev => [...prev, newShape]);
                setSelectedShapeId(newShape.id);
                setDragState({
                    mode: 'create',
                    shapeId: newShape.id,
                    handle: 'se', // Dragging from start corner to opposite
                    startPos: [cx, cy],
                    startVoxel: voxel,
                    startShape: newShape
                });
            }
        }
    }, [isShapeMode, findShapeAtPoint, shapes, canvasToVoxel, shapeType, shapeRoiType, currentSlice]);

    const handleOverlayMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = overlayCanvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        if (!isShapeMode) {
            canvas.style.cursor = 'default';
            return;
        }

        if (dragState.mode && dragState.shapeId && dragState.startShape) {
            const voxel = canvasToVoxel(cx, cy);
            if (!voxel) return;

            const shape = shapes.find(s => s.id === dragState.shapeId);
            if (!shape) return;

            let updatedShape: ShapeROI = { ...shape };

            if (dragState.mode === 'create') {
                // Update size based on drag from start corner
                const [startX, startY] = dragState.startVoxel;
                const [endX, endY] = voxel;
                const newCenterX = (startX + endX) / 2;
                const newCenterY = (startY + endY) / 2;
                const newHalfW = Math.max(0.5, Math.abs(endX - startX) / 2);
                const newHalfH = Math.max(0.5, Math.abs(endY - startY) / 2);
                updatedShape.center = [newCenterX, newCenterY];
                updatedShape.size = [newHalfW, newHalfH];
            } else if (dragState.mode === 'move') {
                // Move shape
                const [startX, startY] = dragState.startVoxel;
                const dx = voxel[0] - startX;
                const dy = voxel[1] - startY;
                updatedShape.center = [
                    dragState.startShape.center[0] + dx,
                    dragState.startShape.center[1] + dy
                ];
            } else if (dragState.mode === 'resize') {
                // Resize based on handle
                const ppv = getPixelsPerVoxel();
                const centerCanvas = voxelToCanvas(dragState.startShape.center[0], dragState.startShape.center[1]);
                if (!centerCanvas) return;

                const [ccx, ccy] = centerCanvas;

                // Transform mouse to local shape coordinates
                const rot = (-dragState.startShape.rotation * Math.PI) / 180;
                const cos = Math.cos(rot);
                const sin = Math.sin(rot);
                const dx = cx - ccx;
                const dy = cy - ccy;
                const localX = dx * cos - dy * sin;
                const localY = dx * sin + dy * cos;

                // Update size based on which handle
                const handle = dragState.handle;
                let [hx, hy] = dragState.startShape.size;

                if (handle === 'e' || handle === 'ne' || handle === 'se') {
                    hx = Math.max(0.5, Math.abs(localX) / ppv);
                }
                if (handle === 'w' || handle === 'nw' || handle === 'sw') {
                    hx = Math.max(0.5, Math.abs(localX) / ppv);
                }
                if (handle === 's' || handle === 'se' || handle === 'sw') {
                    hy = Math.max(0.5, Math.abs(localY) / ppv);
                }
                if (handle === 'n' || handle === 'ne' || handle === 'nw') {
                    hy = Math.max(0.5, Math.abs(localY) / ppv);
                }

                updatedShape.size = [hx, hy];
            } else if (dragState.mode === 'rotate') {
                // Calculate rotation angle
                const centerCanvas = voxelToCanvas(shape.center[0], shape.center[1]);
                if (!centerCanvas) return;
                const [ccx, ccy] = centerCanvas;
                const angle = Math.atan2(cx - ccx, ccy - cy) * (180 / Math.PI);
                updatedShape.rotation = (angle + 360) % 360;
            }

            setShapes(prev => prev.map(s => s.id === dragState.shapeId ? updatedShape : s));
        } else {
            // Update cursor based on what's under mouse
            const hit = findShapeAtPoint(cx, cy);
            if (hit) {
                if (hit.handle === 'center') {
                    canvas.style.cursor = 'move';
                } else if (hit.handle === 'rotate') {
                    canvas.style.cursor = 'grab';
                } else if (hit.handle === 'n' || hit.handle === 's') {
                    canvas.style.cursor = 'ns-resize';
                } else if (hit.handle === 'e' || hit.handle === 'w') {
                    canvas.style.cursor = 'ew-resize';
                } else if (hit.handle === 'nw' || hit.handle === 'se') {
                    canvas.style.cursor = 'nwse-resize';
                } else if (hit.handle === 'ne' || hit.handle === 'sw') {
                    canvas.style.cursor = 'nesw-resize';
                }
            } else {
                canvas.style.cursor = 'crosshair';
            }
        }
    }, [isShapeMode, dragState, shapes, canvasToVoxel, voxelToCanvas, getPixelsPerVoxel, findShapeAtPoint]);

    const handleOverlayMouseUp = useCallback(() => {
        if (dragState.mode) {
            // Finalize the shape and write to bitmap
            writeAllShapesToBitmap();
            setDragState({
                mode: null,
                shapeId: null,
                handle: null,
                startPos: [0, 0],
                startVoxel: [0, 0],
                startShape: null
            });
        }
    }, [dragState.mode, writeAllShapesToBitmap]);

    // Delete selected shape
    const deleteSelectedShape = useCallback(() => {
        if (selectedShapeId) {
            setShapes(prev => prev.filter(s => s.id !== selectedShapeId));
            setSelectedShapeId(null);
            // Need to rewrite bitmap
            setTimeout(() => writeAllShapesToBitmap(), 0);
        }
    }, [selectedShapeId, writeAllShapesToBitmap]);

    // Clear all shapes
    const clearAllShapes = useCallback(() => {
        setShapes([]);
        setSelectedShapeId(null);
        const nv = nvRef.current;
        if (nv) {
            (nv as any).createEmptyDrawing();
            (nv as any).refreshDrawing();
            updateVoxelCounts();
        }
    }, [updateVoxelCounts]);

    // Effect to render overlay when relevant state changes
    useEffect(() => {
        renderOverlay();
    }, [renderOverlay, shapes, selectedShapeId, currentSlice]);

    // Effect to sync overlay canvas size on resize
    useEffect(() => {
        const handleResize = () => {
            renderOverlay();
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [renderOverlay]);

    // ==================== END SHAPE-BASED ROI SYSTEM ====================

    // Simple SVG Line Chart Component
    const SimulationChart: FC<{ data: SimulationResult }> = ({ data }) => {
        const width = 340;
        const height = 200;
        const padding = { top: 20, right: 20, bottom: 40, left: 50 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Filter out null values and find min/max
        const validValues = [
            ...data.classic.filter((v): v is number => v !== null),
            ...data.alps_pas.filter((v): v is number => v !== null),
            ...data.refined.filter((v): v is number => v !== null),
            ...data.refined_local.filter((v): v is number => v !== null)
        ];

        if (validValues.length === 0) {
            return <div className="text-xs text-muted-foreground text-center py-4">No valid data to display</div>;
        }

        const minY = Math.min(...validValues) * 0.95;
        const maxY = Math.max(...validValues) * 1.05;
        const minX = Math.min(...data.angles);
        const maxX = Math.max(...data.angles);

        const scaleX = (x: number) => padding.left + ((x - minX) / (maxX - minX)) * chartWidth;
        const scaleY = (y: number) => padding.top + chartHeight - ((y - minY) / (maxY - minY)) * chartHeight;

        const createPath = (values: (number | null)[]) => {
            const points = data.angles
                .map((angle, i) => ({ x: angle, y: values[i] }))
                .filter((p): p is { x: number; y: number } => p.y !== null);

            if (points.length < 2) return '';
            return points.map((p, i) =>
                `${i === 0 ? 'M' : 'L'} ${scaleX(p.x).toFixed(1)} ${scaleY(p.y).toFixed(1)}`
            ).join(' ');
        };

        // Generate Y-axis ticks
        const yTicks = [];
        const yRange = maxY - minY;
        const yStep = yRange / 4;
        for (let i = 0; i <= 4; i++) {
            yTicks.push(minY + i * yStep);
        }

        // Generate X-axis ticks
        const xTicks = data.angles.filter((_, i) => i % 3 === 0 || i === data.angles.length - 1);

        return (
            <svg width={width} height={height} className="bg-black/30 rounded">
                {/* Grid lines */}
                {yTicks.map((tick, i) => (
                    <line
                        key={`y-grid-${i}`}
                        x1={padding.left}
                        y1={scaleY(tick)}
                        x2={width - padding.right}
                        y2={scaleY(tick)}
                        stroke="rgba(255,255,255,0.1)"
                        strokeDasharray="2,2"
                    />
                ))}
                <line
                    x1={scaleX(0)}
                    y1={padding.top}
                    x2={scaleX(0)}
                    y2={height - padding.bottom}
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth="1"
                />

                {/* Axes */}
                <line
                    x1={padding.left}
                    y1={height - padding.bottom}
                    x2={width - padding.right}
                    y2={height - padding.bottom}
                    stroke="rgba(255,255,255,0.5)"
                />
                <line
                    x1={padding.left}
                    y1={padding.top}
                    x2={padding.left}
                    y2={height - padding.bottom}
                    stroke="rgba(255,255,255,0.5)"
                />

                {/* Y-axis labels */}
                {yTicks.map((tick, i) => (
                    <text
                        key={`y-label-${i}`}
                        x={padding.left - 5}
                        y={scaleY(tick)}
                        textAnchor="end"
                        alignmentBaseline="middle"
                        className="text-[10px] fill-gray-400"
                    >
                        {tick.toFixed(2)}
                    </text>
                ))}

                {/* X-axis labels */}
                {xTicks.map((tick, i) => (
                    <text
                        key={`x-label-${i}`}
                        x={scaleX(tick)}
                        y={height - padding.bottom + 15}
                        textAnchor="middle"
                        className="text-[10px] fill-gray-400"
                    >
                        {tick}°
                    </text>
                ))}

                {/* Axis titles */}
                <text
                    x={width / 2}
                    y={height - 5}
                    textAnchor="middle"
                    className="text-[11px] fill-gray-300"
                >
                    Rotation ({(data.rotation_axis || 'x').toUpperCase()}-axis){data.hemisphere ? `, ${data.hemisphere.charAt(0).toUpperCase() + data.hemisphere.slice(1)} Hemisphere` : ''}
                </text>
                <text
                    x={12}
                    y={height / 2}
                    textAnchor="middle"
                    transform={`rotate(-90, 12, ${height / 2})`}
                    className="text-[11px] fill-gray-300"
                >
                    ALPS Index
                </text>

                {/* Data lines (colorblind-safe: blue, cyan, orange, pink) */}
                <path d={createPath(data.classic)} fill="none" stroke="#0072B2" strokeWidth="2" />
                <path d={createPath(data.alps_pas)} fill="none" stroke="#00CED1" strokeWidth="2" strokeDasharray="6,3" />
                <path d={createPath(data.refined)} fill="none" stroke="#E69F00" strokeWidth="2" />
                <path d={createPath(data.refined_local)} fill="none" stroke="#CC79A7" strokeWidth="2" strokeDasharray="4,2" />

                {/* Legend (colorblind-safe) */}
                <g transform={`translate(${padding.left + 5}, ${padding.top + 5})`}>
                    <rect x="0" y="0" width="80" height="58" fill="rgba(0,0,0,0.5)" rx="3" />
                    <line x1="5" y1="10" x2="20" y2="10" stroke="#0072B2" strokeWidth="2" />
                    <text x="25" y="13" className="text-[9px] fill-gray-300">Classic</text>
                    <line x1="5" y1="23" x2="20" y2="23" stroke="#00CED1" strokeWidth="2" strokeDasharray="6,3" />
                    <text x="25" y="26" className="text-[9px] fill-cyan-400">ALPS-PAS</text>
                    <line x1="5" y1="36" x2="20" y2="36" stroke="#E69F00" strokeWidth="2" />
                    <text x="25" y="39" className="text-[9px] fill-gray-300">Refined</text>
                    <line x1="5" y1="49" x2="20" y2="49" stroke="#CC79A7" strokeWidth="2" strokeDasharray="4,2" />
                    <text x="25" y="52" className="text-[9px] fill-gray-300">Refined+</text>
                </g>
            </svg>
        );
    };

    // Open publication-ready chart in a new window
    const openPublicationChart = () => {
        if (!simulationResult) return;

        const data = simulationResult;
        const width = 600;
        const height = 400;
        const padding = { top: 40, right: 40, bottom: 60, left: 70 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Filter out null values and find min/max
        const validValues = [
            ...data.classic.filter((v): v is number => v !== null),
            ...data.alps_pas.filter((v): v is number => v !== null),
            ...data.refined.filter((v): v is number => v !== null),
            ...data.refined_local.filter((v): v is number => v !== null)
        ];

        if (validValues.length === 0) return;

        const minY = Math.min(...validValues) * 0.95;
        const maxY = Math.max(...validValues) * 1.05;
        const minX = Math.min(...data.angles);
        const maxX = Math.max(...data.angles);

        const scaleX = (x: number) => padding.left + ((x - minX) / (maxX - minX)) * chartWidth;
        const scaleY = (y: number) => padding.top + chartHeight - ((y - minY) / (maxY - minY)) * chartHeight;

        const createPath = (values: (number | null)[]) => {
            const points = data.angles
                .map((angle, i) => ({ x: angle, y: values[i] }))
                .filter((p): p is { x: number; y: number } => p.y !== null);
            if (points.length < 2) return '';
            return points.map((p, i) =>
                `${i === 0 ? 'M' : 'L'} ${scaleX(p.x).toFixed(1)} ${scaleY(p.y).toFixed(1)}`
            ).join(' ');
        };

        // Generate ticks
        const yTicks: number[] = [];
        const yRange = maxY - minY;
        const yStep = yRange / 5;
        for (let i = 0; i <= 5; i++) {
            yTicks.push(minY + i * yStep);
        }
        const xTicks = data.angles.filter((_, i) => i % 2 === 0 || i === data.angles.length - 1);

        // Colorblind-safe palette (distinguishable by color and pattern)
        const colorClassic = '#0072B2';   // Blue
        const colorALPSPAS = '#00CED1';   // Cyan/Turquoise
        const colorRefined = '#E69F00';   // Orange
        const colorRefinedPlus = '#CC79A7'; // Pink/Purple

        const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>
        .axis-label { font-family: Arial, Helvetica, sans-serif; font-size: 14px; fill: #333; }
        .axis-title { font-family: Arial, Helvetica, sans-serif; font-size: 16px; font-weight: bold; fill: #333; }
        .legend-text { font-family: Arial, Helvetica, sans-serif; font-size: 14px; fill: #333; }
        .title { font-family: Arial, Helvetica, sans-serif; font-size: 18px; font-weight: bold; fill: #333; }
    </style>

    <!-- White background -->
    <rect width="${width}" height="${height}" fill="white"/>

    <!-- Grid lines -->
    ${yTicks.map(tick => `<line x1="${padding.left}" y1="${scaleY(tick)}" x2="${width - padding.right}" y2="${scaleY(tick)}" stroke="#e0e0e0" stroke-width="1"/>`).join('\n    ')}

    <!-- Zero line (if in range) -->
    ${minX <= 0 && maxX >= 0 ? `<line x1="${scaleX(0)}" y1="${padding.top}" x2="${scaleX(0)}" y2="${height - padding.bottom}" stroke="#999" stroke-width="1" stroke-dasharray="4,4"/>` : ''}

    <!-- Axes -->
    <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#333" stroke-width="1.5"/>
    <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#333" stroke-width="1.5"/>

    <!-- Y-axis ticks and labels -->
    ${yTicks.map(tick => `
    <line x1="${padding.left - 5}" y1="${scaleY(tick)}" x2="${padding.left}" y2="${scaleY(tick)}" stroke="#333" stroke-width="1.5"/>
    <text x="${padding.left - 10}" y="${scaleY(tick)}" text-anchor="end" dominant-baseline="middle" class="axis-label">${tick.toFixed(2)}</text>`).join('')}

    <!-- X-axis ticks and labels -->
    ${xTicks.map(tick => `
    <line x1="${scaleX(tick)}" y1="${height - padding.bottom}" x2="${scaleX(tick)}" y2="${height - padding.bottom + 5}" stroke="#333" stroke-width="1.5"/>
    <text x="${scaleX(tick)}" y="${height - padding.bottom + 25}" text-anchor="middle" class="axis-label">${tick}°</text>`).join('')}

    <!-- Axis titles -->
    <text x="${width / 2}" y="${height - 10}" text-anchor="middle" class="axis-title">Rotation Around ${(data.rotation_axis || 'X').toUpperCase()}-axis (degrees)</text>
    <text x="${22}" y="${height / 2}" text-anchor="middle" transform="rotate(-90, 22, ${height / 2})" class="axis-title">ALPS Index</text>

    <!-- Data lines (colorblind-safe: blue=Classic, cyan=ALPS-PAS, orange=Refined, pink=Refined+) -->
    <path d="${createPath(data.classic)}" fill="none" stroke="${colorClassic}" stroke-width="2.5"/>
    <path d="${createPath(data.alps_pas)}" fill="none" stroke="${colorALPSPAS}" stroke-width="2.5" stroke-dasharray="10,5"/>
    <path d="${createPath(data.refined)}" fill="none" stroke="${colorRefined}" stroke-width="2.5"/>
    <path d="${createPath(data.refined_local)}" fill="none" stroke="${colorRefinedPlus}" stroke-width="2.5" stroke-dasharray="8,4"/>

    <!-- Legend -->
    <g transform="translate(${width - padding.right - 130}, ${padding.top + 10})">
        <rect x="0" y="0" width="125" height="102" fill="white" stroke="#ccc" stroke-width="1" rx="3"/>
        <line x1="10" y1="20" x2="40" y2="20" stroke="${colorClassic}" stroke-width="2.5"/>
        <text x="48" y="25" class="legend-text">Classic</text>
        <line x1="10" y1="44" x2="40" y2="44" stroke="${colorALPSPAS}" stroke-width="2.5" stroke-dasharray="10,5"/>
        <text x="48" y="49" class="legend-text">ALPS-PAS</text>
        <line x1="10" y1="68" x2="40" y2="68" stroke="${colorRefined}" stroke-width="2.5"/>
        <text x="48" y="73" class="legend-text">Refined</text>
        <line x1="10" y1="92" x2="40" y2="92" stroke="${colorRefinedPlus}" stroke-width="2.5" stroke-dasharray="8,4"/>
        <text x="48" y="97" class="legend-text">Refined+</text>
    </g>
</svg>`;

        // Open in new window
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);

        const newWindow = window.open('', '_blank', `width=${width + 50},height=${height + 100}`);
        if (newWindow) {
            newWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
    <title>ALPS Rotation Simulation${data.hemisphere ? ` - ${data.hemisphere.charAt(0).toUpperCase() + data.hemisphere.slice(1)} Hemisphere` : ''}</title>
    <style>
        body {
            margin: 20px;
            font-family: Arial, sans-serif;
            background: #f5f5f5;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .container {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h3 {
            margin: 0 0 15px 0;
            color: #333;
            text-align: center;
        }
        .buttons {
            margin-top: 15px;
            display: flex;
            gap: 10px;
            justify-content: center;
        }
        button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .save-svg {
            background: #1976d2;
            color: white;
        }
        .save-png {
            background: #388e3c;
            color: white;
        }
        button:hover {
            opacity: 0.9;
        }
        .info {
            margin-top: 10px;
            font-size: 12px;
            color: #666;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <h3>${data.hemisphere ? data.hemisphere.charAt(0).toUpperCase() + data.hemisphere.slice(1) + ' Hemisphere - ' : ''}${(data.rotation_axis || 'X').toUpperCase()}-axis Rotation</h3>
        <div id="chart">${svgContent}</div>
        <div class="buttons">
            <button class="save-svg" onclick="saveSVG()">Save as SVG</button>
            <button class="save-png" onclick="savePNG()">Save as PNG</button>
        </div>
        <div class="info">SVG recommended for publications (vector format, scales perfectly)</div>
    </div>
    <script>
        function saveSVG() {
            const svg = document.querySelector('#chart svg');
            const serializer = new XMLSerializer();
            const svgStr = serializer.serializeToString(svg);
            const blob = new Blob([svgStr], { type: 'image/svg+xml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'alps_rotation_simulation.svg';
            a.click();
            URL.revokeObjectURL(url);
        }

        function savePNG() {
            const svg = document.querySelector('#chart svg');
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const scale = 2; // 2x resolution for crisp output
            canvas.width = ${width} * scale;
            canvas.height = ${height} * scale;
            ctx.scale(scale, scale);
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, ${width}, ${height});

            const serializer = new XMLSerializer();
            const svgStr = serializer.serializeToString(svg);
            const img = new Image();
            img.onload = function() {
                ctx.drawImage(img, 0, 0);
                const pngUrl = canvas.toDataURL('image/png');
                const a = document.createElement('a');
                a.href = pngUrl;
                a.download = 'alps_rotation_simulation.png';
                a.click();
            };
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
        }
    </script>
</body>
</html>
            `);
            newWindow.document.close();
        }

        URL.revokeObjectURL(url);
    };

    return (
        <div className={`fixed inset-0 z-50 bg-background flex flex-col ${isFullscreen ? 'p-0' : 'p-4'}`}>
            {/* Toolbar */}
            <div className="flex items-center justify-between bg-card border border-border p-2 rounded-t-lg shrink-0">
                <div className="flex items-center gap-3">
                    <h2 className="font-bold text-base flex items-center gap-2">
                        <Activity className="w-4 h-4 text-blue-400" />
                        <span>DTI-ALPS Analysis</span>
                        <span className="text-xs font-normal text-muted-foreground ml-1 max-w-40 truncate">
                            {session?.name || 'Untitled'}
                        </span>
                    </h2>
                </div>

                <div className="flex items-center gap-1">
                    <button
                        className="p-1.5 hover:bg-secondary rounded transition-colors text-muted-foreground"
                        title="Undo"
                        onClick={undoDrawing}
                    >
                        <span className="text-xs">Undo</span>
                    </button>
                    <button
                        className="p-1.5 hover:bg-secondary rounded transition-colors text-muted-foreground"
                        title="Fullscreen"
                        onClick={() => setIsFullscreen(!isFullscreen)}
                    >
                        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                    <button
                        className="p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded transition-colors text-muted-foreground"
                        onClick={onClose}
                        title="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden border-x border-border bg-black">
                {/* Left Panel - Viewer */}
                <div className="flex-1 flex flex-col p-2 min-w-0">
                    <div className="relative flex-1 bg-black rounded overflow-hidden">
                        <canvas
                            ref={canvasRef}
                            className="w-full h-full block"
                        />

                        {/* Shape Drawing Overlay Canvas */}
                        {isShapeMode && (
                            <canvas
                                ref={overlayCanvasRef}
                                className="absolute inset-0 w-full h-full"
                                style={{ pointerEvents: 'none' }}
                                onMouseDown={handleOverlayMouseDown}
                                onMouseMove={handleOverlayMouseMove}
                                onMouseUp={handleOverlayMouseUp}
                                onMouseLeave={handleOverlayMouseUp}
                            />
                        )}
                        {/* Transparent interaction layer for shape mode - passes wheel events through */}
                        {isShapeMode && (
                            <div
                                className="absolute inset-0"
                                style={{ pointerEvents: 'auto' }}
                                onMouseDown={(e) => {
                                    // Forward to overlay handler
                                    handleOverlayMouseDown(e as any);
                                }}
                                onMouseMove={(e) => {
                                    handleOverlayMouseMove(e as any);
                                }}
                                onMouseUp={handleOverlayMouseUp}
                                onMouseLeave={handleOverlayMouseUp}
                                onWheel={(e) => {
                                    // Pass wheel events to the NiiVue canvas
                                    const nvCanvas = canvasRef.current;
                                    if (nvCanvas) {
                                        const wheelEvent = new WheelEvent('wheel', {
                                            deltaY: e.deltaY,
                                            deltaX: e.deltaX,
                                            clientX: e.clientX,
                                            clientY: e.clientY,
                                            bubbles: true
                                        });
                                        nvCanvas.dispatchEvent(wheelEvent);
                                    }
                                }}
                            />
                        )}

                        {/* Orientation Labels (Radiological convention: R on left, L on right) */}
                        {!isLoading && !loadError && (
                            <>
                                <span className="absolute left-1 top-1/2 -translate-y-1/2 text-white text-sm font-bold opacity-80 z-20 pointer-events-none select-none">R</span>
                                <span className="absolute right-1 top-1/2 -translate-y-1/2 text-white text-sm font-bold opacity-80 z-20 pointer-events-none select-none">L</span>
                                <span className="absolute top-1 left-1/2 -translate-x-1/2 text-white text-sm font-bold opacity-80 z-20 pointer-events-none select-none">A</span>
                                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-white text-sm font-bold opacity-80 z-20 pointer-events-none select-none">P</span>
                            </>
                        )}

                        {/* Loading Overlay */}
                        {isLoading && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30">
                                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
                                <span className="text-sm text-blue-400">Loading Color FA...</span>
                            </div>
                        )}

                        {/* Error Overlay */}
                        {loadError && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30">
                                <span className="text-sm text-red-400 mb-2">Error: {loadError}</span>
                                <button onClick={onClose} className="px-3 py-1 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30">
                                    Close
                                </button>
                            </div>
                        )}

                        {/* Drawing Mode Indicator */}
                        {drawingMode && (
                            <div className={`absolute top-2 left-2 px-3 py-1.5 rounded text-xs font-medium z-30 ${(drawingMode === 'proj' || drawingMode === 'proj-fill') ? 'bg-blue-500/80 text-white' :
                                (drawingMode === 'assoc' || drawingMode === 'assoc-fill') ? 'bg-green-500/80 text-white' :
                                    'bg-red-500/80 text-white'
                                }`}>
                                {(drawingMode === 'proj-fill' || drawingMode === 'assoc-fill') ? (
                                    <Square className="w-3 h-3 inline mr-1" />
                                ) : (
                                    <Pencil className="w-3 h-3 inline mr-1" />
                                )}
                                {drawingMode === 'proj' ? 'Painting SCR (freehand)' :
                                    drawingMode === 'proj-fill' ? 'SCR Fill Mode - Click to flood fill' :
                                        drawingMode === 'assoc' ? 'Painting SLF (freehand)' :
                                            drawingMode === 'assoc-fill' ? 'SLF Fill Mode - Click to flood fill' :
                                                'Erasing'}
                            </div>
                        )}
                    </div>

                    {/* Slice Navigation */}
                    <div className="flex items-center gap-2 mt-2 px-2">
                        <button
                            onClick={() => {
                                sliceChangeFromSliderRef.current = true;
                                setCurrentSlice(prev => Math.max(0, prev - 1));
                            }}
                            className="p-1 hover:bg-secondary rounded"
                            disabled={currentSlice <= 0}
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <input
                            type="range"
                            min={0}
                            max={maxSlice}
                            value={currentSlice}
                            onChange={(e) => {
                                sliceChangeFromSliderRef.current = true;
                                setCurrentSlice(parseInt(e.target.value));
                            }}
                            className="flex-1"
                        />
                        <button
                            onClick={() => {
                                sliceChangeFromSliderRef.current = true;
                                setCurrentSlice(prev => Math.min(maxSlice, prev + 1));
                            }}
                            className="p-1 hover:bg-secondary rounded"
                            disabled={currentSlice >= maxSlice}
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                        <span className="text-xs text-muted-foreground w-20 text-center">
                            Slice {currentSlice} / {maxSlice}
                        </span>
                    </div>
                </div>

                {/* Right Panel - Controls & Results */}
                <div className="w-80 border-l border-border bg-card p-4 overflow-y-auto">
                    {/* Instructions */}
                    <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                        <div className="flex items-start gap-2">
                            <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                            <div className="text-xs text-muted-foreground">
                                <p className="font-medium text-blue-400 mb-1">Instructions:</p>
                                <ol className="list-decimal list-inside space-y-1">
                                    <li>Use <span className="text-blue-400">Paint</span> for freehand or <span className="text-blue-400">Fill ROI</span> for flood fill</li>
                                    <li>Mark <span className="text-blue-400">SCR</span> (projection) and <span className="text-green-400">SLF</span> (association) fibers</li>
                                    <li>Use <span className="text-red-400">Eraser</span> to correct mistakes</li>
                                    <li>Click Compute ALPS when both ROIs are marked</li>
                                </ol>
                            </div>
                        </div>
                    </div>

                    {/* Drawing Controls */}
                    <div className="mb-4">
                        <h3 className="text-sm font-medium mb-2">Drawing Tools</h3>


                        {/* Mode Toggle */}
                        <div className="mb-3 flex items-center justify-center gap-2">
                            <button
                                onClick={() => { setIsShapeMode(false); setDrawingMode(null); }}
                                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                                    !isShapeMode
                                        ? 'bg-gray-600 text-white'
                                        : 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30'
                                }`}
                            >
                                Freehand
                            </button>
                            <button
                                onClick={() => { setIsShapeMode(true); setDrawingMode(null); }}
                                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                                    isShapeMode
                                        ? 'bg-gray-600 text-white'
                                        : 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30'
                                }`}
                            >
                                Shapes
                            </button>
                        </div>

                        {/* Shape Mode Controls */}
                        {isShapeMode && (
                            <div className="mb-3 p-2 bg-orange-500/10 border border-orange-500/30 rounded-lg space-y-2">
                                <div className="text-[10px] text-orange-300 font-medium text-center">Shape Drawing Mode</div>

                                {/* Shape Type */}
                                <div className="flex items-center justify-center gap-2">
                                    <span className="text-[9px] text-gray-400">Shape:</span>
                                    <button
                                        onClick={() => setShapeType('rectangle')}
                                        className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                            shapeType === 'rectangle'
                                                ? 'bg-orange-500 text-white'
                                                : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
                                        }`}
                                    >
                                        Rectangle
                                    </button>
                                    <button
                                        onClick={() => setShapeType('ellipse')}
                                        className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                            shapeType === 'ellipse'
                                                ? 'bg-orange-500 text-white'
                                                : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
                                        }`}
                                    >
                                        Ellipse
                                    </button>
                                </div>

                                {/* ROI Type */}
                                <div className="flex items-center justify-center gap-2">
                                    <span className="text-[9px] text-gray-400">ROI:</span>
                                    <button
                                        onClick={() => setShapeRoiType('proj')}
                                        className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                            shapeRoiType === 'proj'
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                                        }`}
                                    >
                                        SCR (Blue)
                                    </button>
                                    <button
                                        onClick={() => setShapeRoiType('assoc')}
                                        className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                                            shapeRoiType === 'assoc'
                                                ? 'bg-green-500 text-white'
                                                : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                        }`}
                                    >
                                        SLF (Green)
                                    </button>
                                </div>

                                {/* Instructions */}
                                <div className="text-[9px] text-gray-400 text-center">
                                    Click & drag to create. Drag handles to resize/rotate.
                                </div>

                                {/* Shape counts */}
                                <div className="text-[9px] text-center">
                                    <span className="text-blue-400">SCR: {shapes.filter(s => s.roiType === 'proj').length}</span>
                                    {' | '}
                                    <span className="text-green-400">SLF: {shapes.filter(s => s.roiType === 'assoc').length}</span>
                                </div>

                                {/* Delete / Clear buttons */}
                                <div className="flex items-center justify-center gap-2">
                                    <button
                                        onClick={deleteSelectedShape}
                                        disabled={!selectedShapeId}
                                        className="px-2 py-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded text-[10px] font-medium transition-colors"
                                    >
                                        Delete Selected
                                    </button>
                                    <button
                                        onClick={clearAllShapes}
                                        disabled={shapes.length === 0}
                                        className="px-2 py-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed rounded text-[10px] font-medium transition-colors"
                                    >
                                        Clear All
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Freehand Mode Controls */}
                        {!isShapeMode && (
                            <>
                        {/* SCR Tools */}
                        <div className="mb-2">
                            <div className="text-xs text-blue-400 mb-1">SCR (Projection Fibers)</div>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setDrawingMode(drawingMode === 'proj' ? null : 'proj')}
                                    className={`flex items-center justify-center gap-1 p-2 rounded text-xs font-medium transition-colors ${drawingMode === 'proj'
                                        ? 'bg-blue-500 text-white ring-2 ring-blue-300'
                                        : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                                        }`}
                                >
                                    <Pencil className="w-3 h-3" />
                                    Paint
                                </button>
                                <button
                                    onClick={() => setDrawingMode(drawingMode === 'proj-fill' ? null : 'proj-fill')}
                                    className={`flex items-center justify-center gap-1 p-2 rounded text-xs font-medium transition-colors ${drawingMode === 'proj-fill'
                                        ? 'bg-blue-500 text-white ring-2 ring-blue-300'
                                        : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                                        }`}
                                >
                                    <Square className="w-3 h-3" />
                                    Fill ROI
                                </button>
                            </div>
                        </div>

                        {/* SLF Tools */}
                        <div className="mb-2">
                            <div className="text-xs text-green-400 mb-1">SLF (Association Fibers)</div>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setDrawingMode(drawingMode === 'assoc' ? null : 'assoc')}
                                    className={`flex items-center justify-center gap-1 p-2 rounded text-xs font-medium transition-colors ${drawingMode === 'assoc'
                                        ? 'bg-green-500 text-white ring-2 ring-green-300'
                                        : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                        }`}
                                >
                                    <Pencil className="w-3 h-3" />
                                    Paint
                                </button>
                                <button
                                    onClick={() => setDrawingMode(drawingMode === 'assoc-fill' ? null : 'assoc-fill')}
                                    className={`flex items-center justify-center gap-1 p-2 rounded text-xs font-medium transition-colors ${drawingMode === 'assoc-fill'
                                        ? 'bg-green-500 text-white ring-2 ring-green-300'
                                        : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                                        }`}
                                >
                                    <Square className="w-3 h-3" />
                                    Fill ROI
                                </button>
                            </div>
                        </div>

                        {/* Eraser */}
                        <div className="mb-3">
                            <button
                                onClick={() => setDrawingMode(drawingMode === 'erase' ? null : 'erase')}
                                className={`w-full flex items-center justify-center gap-1 p-2 rounded text-xs font-medium transition-colors ${drawingMode === 'erase'
                                    ? 'bg-red-500 text-white ring-2 ring-red-300'
                                    : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                                    }`}
                            >
                                <Eraser className="w-3 h-3" />
                                Eraser
                            </button>
                        </div>
                            </>
                        )}

                        {/* Voxel counts */}
                        <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                            <div className="p-2 bg-blue-500/10 rounded">
                                <div className="flex items-center justify-between">
                                    <span className="text-blue-400">SCR:</span>
                                    <span className="font-mono">{projVoxelCount.toLocaleString()}</span>
                                    {projVoxelCount > 0 && (
                                        <button
                                            onClick={() => clearROI(PEN_VALUE_PROJ)}
                                            className="p-1 hover:bg-red-500/20 rounded"
                                            title="Clear SCR"
                                        >
                                            <Trash2 className="w-3 h-3 text-red-400" />
                                        </button>
                                    )}
                                </div>
                                {projVoxelCount > 0 && (
                                    <div className="text-[10px] text-muted-foreground mt-1">
                                        L: {projLeftCount} | R: {projRightCount}
                                    </div>
                                )}
                            </div>
                            <div className="p-2 bg-green-500/10 rounded">
                                <div className="flex items-center justify-between">
                                    <span className="text-green-400">SLF:</span>
                                    <span className="font-mono">{assocVoxelCount.toLocaleString()}</span>
                                    {assocVoxelCount > 0 && (
                                        <button
                                            onClick={() => clearROI(PEN_VALUE_ASSOC)}
                                            className="p-1 hover:bg-red-500/20 rounded"
                                            title="Clear SLF"
                                        >
                                            <Trash2 className="w-3 h-3 text-red-400" />
                                        </button>
                                    )}
                                </div>
                                {assocVoxelCount > 0 && (
                                    <div className="text-[10px] text-muted-foreground mt-1">
                                        L: {assocLeftCount} | R: {assocRightCount}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Saved ROI indicator */}
                        {savedRoiMetadata && (
                            <div className="p-2 bg-purple-500/10 rounded text-xs mb-2">
                                <div className="flex items-center gap-1 text-purple-400 font-medium">
                                    <Info className="w-3 h-3" />
                                    ROIs loaded from session
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-1">
                                    Saved: {new Date(savedRoiMetadata.timestamp).toLocaleString()}
                                </div>
                            </div>
                        )}

                        {/* Clear All */}
                        {(projVoxelCount > 0 || assocVoxelCount > 0) && (
                            <button
                                onClick={() => {
                                    clearDrawings();
                                    setSavedRoiMetadata(null); // Clear saved metadata when clearing drawings
                                }}
                                className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                            >
                                <Trash2 className="w-3 h-3" />
                                Clear All Drawings
                            </button>
                        )}
                    </div>

                    {/* Analysis Settings */}
                    <div className="mb-4 space-y-3">
                        <h3 className="text-sm font-medium">Analysis Settings</h3>

                        {/* B-value Shell Selector */}
                        {shellInfo.length > 0 && (
                            <div>
                                <label className="text-xs text-muted-foreground">B-value Shell</label>
                                <div className="flex items-center gap-2">
                                    <select
                                        value={selectedBValue ?? ''}
                                        onChange={(e) => {
                                            const bv = parseInt(e.target.value);
                                            setSelectedBValue(bv);
                                            reloadColorFA(bv);
                                        }}
                                        disabled={isReloadingColorFA}
                                        className="flex-1 bg-secondary text-foreground text-xs rounded px-2 py-1 border border-border"
                                    >
                                        {shellInfo.map((shell) => (
                                            <option key={shell.b_value} value={shell.b_value}>
                                                b={shell.b_value} ({shell.n_directions} dir)
                                            </option>
                                        ))}
                                    </select>
                                    {isReloadingColorFA && (
                                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                                    )}
                                </div>
                            </div>
                        )}

                        {/* FA Threshold */}
                        <div>
                            <label className="text-xs text-muted-foreground">FA Threshold</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="range"
                                    min={0}
                                    max={0.5}
                                    step={0.05}
                                    value={faThreshold}
                                    onChange={(e) => setFaThreshold(parseFloat(e.target.value))}
                                    className="flex-1"
                                />
                                <span className="text-xs text-muted-foreground w-10 text-right">{(faThreshold ?? 0.2).toFixed(2)}</span>
                            </div>
                        </div>

                        {/* FA Cap (optional) */}
                        <div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="fa-cap"
                                    checked={useFaCap}
                                    onChange={(e) => setUseFaCap(e.target.checked)}
                                    className="rounded"
                                />
                                <label htmlFor="fa-cap" className="text-xs text-muted-foreground" title="Limits influence of high-FA voxels when computing mean tract direction">
                                    Limit high-FA outlier influence
                                </label>
                            </div>
                            {useFaCap && (
                                <div className="flex items-center gap-2 mt-1 ml-5">
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">Cap at</span>
                                    <input
                                        type="range"
                                        min={80}
                                        max={100}
                                        step={1}
                                        value={faCap}
                                        onChange={(e) => setFaCap(parseInt(e.target.value))}
                                        className="flex-1"
                                    />
                                    <span className="text-xs text-muted-foreground w-16 text-right">{faCap}th %ile</span>
                                </div>
                            )}
                        </div>

                        {/* Hemisphere Selection */}
                        <div>
                            <label className="text-xs text-muted-foreground block mb-1">Hemisphere</label>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setHemisphere('left')}
                                    className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${hemisphere === 'left'
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                                        }`}
                                >
                                    Left
                                </button>
                                <button
                                    onClick={() => setHemisphere('both')}
                                    className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${hemisphere === 'both'
                                        ? 'bg-purple-500 text-white'
                                        : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                                        }`}
                                >
                                    Both
                                </button>
                                <button
                                    onClick={() => setHemisphere('right')}
                                    className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${hemisphere === 'right'
                                        ? 'bg-blue-500 text-white'
                                        : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                                        }`}
                                >
                                    Right
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Compute Button */}
                    <div className="mb-4 space-y-2">
                        <button
                            onClick={computeALPS}
                            disabled={projVoxelCount === 0 || assocVoxelCount === 0 || isComputing}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isComputing ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Computing...
                                </>
                            ) : (
                                <>
                                    <Calculator className="w-4 h-4" />
                                    Compute ALPS
                                </>
                            )}
                        </button>
                        <button
                            onClick={loadPreviousResults}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-border text-foreground rounded-lg font-medium hover:bg-secondary transition-colors"
                            title="Load previously saved ALPS results for this session"
                        >
                            <Upload className="w-4 h-4" />
                            Load Previous Results
                        </button>
                        {computeError && (
                            <p className="text-xs text-red-400 mt-1">{computeError}</p>
                        )}
                    </div>

                    {/* Results */}
                    {alpsResults && (
                        <div className="border border-border rounded-lg overflow-hidden">
                            <div className="bg-secondary/50 px-3 py-2 flex items-center justify-between">
                                <h3 className="text-sm font-medium">Results</h3>
                                <button
                                    onClick={exportResults}
                                    className="p-1 hover:bg-secondary rounded"
                                    title="Export results"
                                >
                                    <Download className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="p-3 space-y-3">
                                {/* Per-Hemisphere Results */}
                                {(alpsResults.left || alpsResults.right) ? (
                                    <div className="grid grid-cols-2 gap-2">
                                        {alpsResults.left && (
                                            <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2">
                                                <div className="text-xs text-blue-400 font-medium mb-2">Left Hemisphere</div>
                                                <div className="space-y-1">
                                                    {alpsResults.left.classic && (
                                                        <div className="flex justify-between text-xs">
                                                            <span className="text-muted-foreground">Classic:</span>
                                                            <span className="font-bold">{alpsResults.left.classic.alps_index.toFixed(3)}</span>
                                                        </div>
                                                    )}
                                                    {alpsResults.left.orientation_aware && (
                                                        <div className="flex justify-between text-xs">
                                                            <span className="text-muted-foreground">Refined:</span>
                                                            <span className="font-bold">
                                                                {alpsResults.left.orientation_aware.alps_index !== null
                                                                    ? alpsResults.left.orientation_aware.alps_index.toFixed(3)
                                                                    : 'N/A'}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {alpsResults.left.refined_local && (
                                                        <div className="flex justify-between text-xs">
                                                            <span className="text-muted-foreground">Refined+:</span>
                                                            <span className="font-bold">{alpsResults.left.refined_local.alps_index.toFixed(3)}</span>
                                                        </div>
                                                    )}
                                                    {alpsResults.left.alps_pas && (
                                                        <div className="flex justify-between text-xs">
                                                            <span className="text-muted-foreground">ALPS-PAS:</span>
                                                            <span className="font-bold text-cyan-400">{alpsResults.left.alps_pas.alps_index.toFixed(3)}</span>
                                                        </div>
                                                    )}
                                                    {alpsResults.left.refined_local?.delta_phi_deg != null && (
                                                        <div className="text-[10px] text-muted-foreground text-right">
                                                            Δφ={alpsResults.left.refined_local.delta_phi_deg.toFixed(1)}°
                                                        </div>
                                                    )}
                                                </div>
                                                {alpsResults.left.roi_stats && (
                                                    <div className="text-[10px] text-muted-foreground mt-2 pt-1 border-t border-blue-500/20">
                                                        SCR: {alpsResults.left.roi_stats.proj_voxels}, SLF: {alpsResults.left.roi_stats.assoc_voxels}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {alpsResults.right && (
                                            <div className="bg-purple-500/10 border border-purple-500/20 rounded p-2">
                                                <div className="text-xs text-purple-400 font-medium mb-2">Right Hemisphere</div>
                                                <div className="space-y-1">
                                                    {alpsResults.right.classic && (
                                                        <div className="flex justify-between text-xs">
                                                            <span className="text-muted-foreground">Classic:</span>
                                                            <span className="font-bold">{alpsResults.right.classic.alps_index.toFixed(3)}</span>
                                                        </div>
                                                    )}
                                                    {alpsResults.right.orientation_aware && (
                                                        <div className="flex justify-between text-xs">
                                                            <span className="text-muted-foreground">Refined:</span>
                                                            <span className="font-bold">
                                                                {alpsResults.right.orientation_aware.alps_index !== null
                                                                    ? alpsResults.right.orientation_aware.alps_index.toFixed(3)
                                                                    : 'N/A'}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {alpsResults.right.refined_local && (
                                                        <div className="flex justify-between text-xs">
                                                            <span className="text-muted-foreground">Refined+:</span>
                                                            <span className="font-bold">{alpsResults.right.refined_local.alps_index.toFixed(3)}</span>
                                                        </div>
                                                    )}
                                                    {alpsResults.right.alps_pas && (
                                                        <div className="flex justify-between text-xs">
                                                            <span className="text-muted-foreground">ALPS-PAS:</span>
                                                            <span className="font-bold text-cyan-400">{alpsResults.right.alps_pas.alps_index.toFixed(3)}</span>
                                                        </div>
                                                    )}
                                                    {alpsResults.right.refined_local?.delta_phi_deg != null && (
                                                        <div className="text-[10px] text-muted-foreground text-right">
                                                            Δφ={alpsResults.right.refined_local.delta_phi_deg.toFixed(1)}°
                                                        </div>
                                                    )}
                                                </div>
                                                {alpsResults.right.roi_stats && (
                                                    <div className="text-[10px] text-muted-foreground mt-2 pt-1 border-t border-purple-500/20">
                                                        SCR: {alpsResults.right.roi_stats.proj_voxels}, SLF: {alpsResults.right.roi_stats.assoc_voxels}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-xs text-muted-foreground text-center py-2">
                                        No per-hemisphere results available. Ensure ROIs are drawn on both sides.
                                    </div>
                                )}

                                {alpsResults.orientation_aware?.error && (
                                    <div className="text-xs text-yellow-400 bg-yellow-500/10 p-2 rounded">
                                        {alpsResults.orientation_aware.error}
                                    </div>
                                )}

                                {/* Angle QC Metric */}
                                {alpsResults.orientation_aware?.theta_deg !== undefined && (
                                    <div className="flex items-center gap-2 p-2 bg-secondary/20 rounded">
                                        <span className="text-xs text-muted-foreground">Angle QC (θ):</span>
                                        <span className={`text-xs font-bold ${alpsResults.orientation_aware.theta_deg >= 60 && alpsResults.orientation_aware.theta_deg <= 120
                                            ? 'text-green-400'
                                            : 'text-yellow-400'
                                            }`}>
                                            {alpsResults.orientation_aware.theta_deg.toFixed(1)}°
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {alpsResults.orientation_aware.theta_deg >= 60 && alpsResults.orientation_aware.theta_deg <= 120
                                                ? '(good - near orthogonal)'
                                                : '(warning - may indicate ROI misplacement)'}
                                        </span>
                                    </div>
                                )}

                                {/* ROI Stats */}
                                {alpsResults.roi_stats && (
                                    <div>
                                        <div className="text-xs font-medium text-muted-foreground mb-1">ROI Statistics (Combined)</div>
                                        <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div>
                                                <span className="text-blue-400">SCR:</span>{' '}
                                                {alpsResults.roi_stats.proj_voxels} voxels, FA={alpsResults.roi_stats.proj_mean_fa.toFixed(3)}
                                            </div>
                                            <div>
                                                <span className="text-green-400">SLF:</span>{' '}
                                                {alpsResults.roi_stats.assoc_voxels} voxels, FA={alpsResults.roi_stats.assoc_mean_fa.toFixed(3)}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Classic Details */}
                                {alpsResults.classic?.Dx_proj != null && (
                                    <div>
                                        <div className="text-xs font-medium text-muted-foreground mb-1">Classic Method Details</div>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono bg-secondary/20 p-2 rounded">
                                            <div>Dx_proj: {(alpsResults.classic.Dx_proj * 1000).toFixed(4)}</div>
                                            <div>Dx_assoc: {(alpsResults.classic.Dx_assoc * 1000).toFixed(4)}</div>
                                            <div>Dy_proj: {(alpsResults.classic.Dy_proj * 1000).toFixed(4)}</div>
                                            <div>Dz_assoc: {(alpsResults.classic.Dz_assoc * 1000).toFixed(4)}</div>
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            Values in 10<sup>-3</sup> mm<sup>2</sup>/s
                                        </div>
                                    </div>
                                )}

                                {/* Orientation-Aware Details */}
                                {alpsResults.orientation_aware?.v_proj && alpsResults.orientation_aware.alps_index !== null && (
                                    <div>
                                        <div className="text-xs font-medium text-muted-foreground mb-1">Orientation-Aware Details</div>
                                        <div className="text-xs font-mono bg-secondary/20 p-2 rounded space-y-1">
                                            <div className="text-blue-400">
                                                v_proj: [{alpsResults.orientation_aware.v_proj.map(v => v.toFixed(3)).join(', ')}]
                                            </div>
                                            <div className="text-green-400">
                                                v_assoc: [{alpsResults.orientation_aware.v_assoc.map(v => v.toFixed(3)).join(', ')}]
                                            </div>
                                            {alpsResults.orientation_aware.d_pvs && (
                                                <div className="text-purple-400">
                                                    p̂ (PVS): [{alpsResults.orientation_aware.d_pvs.map(v => v.toFixed(3)).join(', ')}]
                                                </div>
                                            )}
                                            {alpsResults.orientation_aware.o_proj && (
                                                <div className="text-yellow-400">
                                                    ô_proj: [{alpsResults.orientation_aware.o_proj.map(v => v.toFixed(3)).join(', ')}]
                                                </div>
                                            )}
                                            {alpsResults.orientation_aware.o_assoc && (
                                                <div className="text-orange-400">
                                                    ô_assoc: [{alpsResults.orientation_aware.o_assoc.map(v => v.toFixed(3)).join(', ')}]
                                                </div>
                                            )}
                                        </div>
                                        {alpsResults.orientation_aware.D_pvs_proj !== undefined && (
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono bg-secondary/20 p-2 rounded mt-2">
                                                <div>D_pvs_proj: {(alpsResults.orientation_aware.D_pvs_proj! * 1000).toFixed(4)}</div>
                                                <div>D_pvs_assoc: {(alpsResults.orientation_aware.D_pvs_assoc! * 1000).toFixed(4)}</div>
                                                <div>D_orth_proj: {(alpsResults.orientation_aware.D_orth_proj! * 1000).toFixed(4)}</div>
                                                <div>D_orth_assoc: {(alpsResults.orientation_aware.D_orth_assoc! * 1000).toFixed(4)}</div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* ALPS-PAS Details */}
                                {alpsResults.alps_pas?.lambda_x_proj != null && (
                                    <div>
                                        <div className="text-xs font-medium text-muted-foreground mb-1">ALPS-PAS Details (Ajouz et al. 2026)</div>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs font-mono bg-secondary/20 p-2 rounded">
                                            <div>λ_x_proj: {(alpsResults.alps_pas.lambda_x_proj * 1000).toFixed(4)}</div>
                                            <div>λ_x_assoc: {(alpsResults.alps_pas.lambda_x_assoc * 1000).toFixed(4)}</div>
                                            <div>λ_nonx_proj: {(alpsResults.alps_pas.lambda_nonx_proj * 1000).toFixed(4)}</div>
                                            <div>λ_nonx_assoc: {(alpsResults.alps_pas.lambda_nonx_assoc * 1000).toFixed(4)}</div>
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            Values in 10<sup>-3</sup> mm<sup>2</sup>/s. λ_x assigned to radial eigenvalue with larger |x-component|.
                                        </div>
                                    </div>
                                )}

                                {/* FA Cap Info */}
                                {alpsResults.fa_cap_percentile && (
                                    <div className="text-xs text-muted-foreground">
                                        FA weights capped at {alpsResults.fa_cap_percentile}th percentile
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Rotation Simulation */}
                    <div className="border border-border rounded-lg overflow-hidden mt-4">
                        <div className="bg-secondary/50 px-3 py-2 flex items-center justify-between">
                            <h3 className="text-sm font-medium flex items-center gap-2">
                                <BarChart3 className="w-4 h-4" />
                                Rotation Simulation
                            </h3>
                            {simulationResult && (
                                <button
                                    onClick={() => setShowSimulation(!showSimulation)}
                                    className="text-xs text-muted-foreground hover:text-foreground"
                                >
                                    {showSimulation ? 'Hide' : 'Show'}
                                </button>
                            )}
                        </div>

                        <div className="p-3 space-y-3">
                            <div className="text-xs text-muted-foreground">
                                Simulate head rotation to demonstrate orientation sensitivity. Classic ALPS varies significantly with all rotations. ALPS-PAS is invariant to X-axis rotation but shows some sensitivity to Y/Z rotations. Refined methods remain stable across all axes.
                            </div>

                            {/* Rotation Settings */}
                            <div className="space-y-2">
                                <div>
                                    <label className="text-xs text-muted-foreground block mb-1">Rotation Axis</label>
                                    <div className="flex gap-1">
                                        {(['x', 'y', 'z'] as const).map((axis) => (
                                            <button
                                                key={axis}
                                                onClick={() => setRotationAxis(axis)}
                                                className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${rotationAxis === axis
                                                    ? 'bg-purple-500 text-white'
                                                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                                                    }`}
                                            >
                                                {axis.toUpperCase()}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-muted-foreground">Angle Range (±°)</label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="range"
                                            min={10}
                                            max={45}
                                            step={5}
                                            value={angleRange}
                                            onChange={(e) => setAngleRange(parseInt(e.target.value))}
                                            className="flex-1"
                                        />
                                        <span className="text-xs text-muted-foreground w-10 text-right">±{angleRange}°</span>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-muted-foreground block mb-1">Hemisphere (PVS axis differs by side)</label>
                                    <div className="flex gap-1">
                                        {(['left', 'right'] as const).map((hemi) => (
                                            <button
                                                key={hemi}
                                                onClick={() => setSimHemisphere(hemi)}
                                                className={`flex-1 px-2 py-1 rounded text-xs font-medium transition-colors ${simHemisphere === hemi
                                                    ? 'bg-blue-500 text-white'
                                                    : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
                                                    }`}
                                            >
                                                {hemi.charAt(0).toUpperCase() + hemi.slice(1)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Run Simulation Button */}
                            <button
                                onClick={runSimulation}
                                disabled={projVoxelCount === 0 || assocVoxelCount === 0 || isSimulating}
                                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-lg font-medium hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isSimulating ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Simulating...
                                    </>
                                ) : (
                                    <>
                                        <BarChart3 className="w-4 h-4" />
                                        Run Simulation
                                    </>
                                )}
                            </button>

                            {simulationError && (
                                <p className="text-xs text-red-400">{simulationError}</p>
                            )}

                            {/* Simulation Results Chart */}
                            {showSimulation && simulationResult && (
                                <div className="space-y-2">
                                    <SimulationChart data={simulationResult} />
                                    <div className="text-[10px] text-muted-foreground text-center">
                                        Notice how <span style={{ color: '#0072B2' }}>Classic</span> (blue) varies with rotation while{' '}
                                        <span style={{ color: '#E69F00' }}>Refined</span> (orange) and{' '}
                                        <span style={{ color: '#CC79A7' }}>Refined+</span> (pink) remain stable.
                                    </div>
                                    <button
                                        onClick={openPublicationChart}
                                        className="w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-secondary text-foreground rounded text-xs font-medium hover:bg-secondary/80 transition-colors"
                                    >
                                        <Download className="w-3 h-3" />
                                        Export Publication Figure
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Status Bar */}
            <div className="bg-card border border-t-0 border-border text-muted-foreground text-xs p-1 px-4 flex justify-between rounded-b-lg">
                <span>
                    {drawingMode ? (
                        <span className={
                            (drawingMode === 'proj' || drawingMode === 'proj-fill') ? 'text-blue-400' :
                                (drawingMode === 'assoc' || drawingMode === 'assoc-fill') ? 'text-green-400' :
                                    'text-red-400'
                        }>
                            {drawingMode === 'proj' ? 'Painting SCR - Click and drag' :
                                drawingMode === 'proj-fill' ? 'SCR Fill - Click on region to flood fill' :
                                    drawingMode === 'assoc' ? 'Painting SLF - Click and drag' :
                                        drawingMode === 'assoc-fill' ? 'SLF Fill - Click on region to flood fill' :
                                            'Erasing - Click and drag to erase'}
                        </span>
                    ) : (
                        <span>Wheel: Scroll slices | Select a drawing tool to begin</span>
                    )}
                </span>
                <span>
                    SCR: {projVoxelCount.toLocaleString()} | SLF: {assocVoxelCount.toLocaleString()} | Slice: {currentSlice} | Vol: {dims[0]}×{dims[1]}×{dims[2]}
                    {mouseDecValues && mouseDecValues.r !== undefined && (
                        <span className="ml-4">
                            | DEC @ ({mouseDecValues.x},{mouseDecValues.y},{mouseDecValues.z}):
                            <span style={{ color: '#ff6666' }}> R={mouseDecValues.r.toFixed(3)}</span>
                            <span style={{ color: '#66ff66' }}> G={mouseDecValues.g.toFixed(3)}</span>
                            <span style={{ color: '#6666ff' }}> B={mouseDecValues.b.toFixed(3)}</span>
                        </span>
                    )}
                </span>
            </div>
        </div>
    );
};

export default DTIALPSViewer;
