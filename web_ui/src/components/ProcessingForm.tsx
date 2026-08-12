import React, { useState, useEffect } from 'react';
import { Upload, Play, FileText, CheckSquare, Square, FolderOpen, Globe, X, ChevronUp, Folder, File, FolderSearch, RefreshCw, Loader, CheckCircle, XCircle, Archive } from 'lucide-react';
import { uploadAndProcess, processLocalFiles, browseFiles, scanForDatasets, startBatchProcessing, getBatchStatus, cancelBatchProcessing, scanHCPZip, processHCPZip } from '../api';
import type { BrowseItem, BatchScanResult, BatchProcessingStatus, HCPZipScanResult } from '../api';

interface ProcessingFormProps {
    onProcessingStarted: () => void;
}

type InputMode = 'upload' | 'local' | 'batch' | 'hcp_zip';

const ProcessingForm: React.FC<ProcessingFormProps> = ({ onProcessingStarted }) => {
    const [inputMode, setInputMode] = useState<InputMode>('upload');

    // Upload mode state
    const [dwiFile, setDwiFile] = useState<File | null>(null);
    const [bvalFile, setBvalFile] = useState<File | null>(null);
    const [bvecFile, setBvecFile] = useState<File | null>(null);
    const [anatFile, setAnatFile] = useState<File | null>(null);

    // Local path mode state
    const [dwiPath, setDwiPath] = useState('');
    const [bvalPath, setBvalPath] = useState('');
    const [bvecPath, setBvecPath] = useState('');
    const [anatPath, setAnatPath] = useState('');

    // File browser state
    const [browserOpen, setBrowserOpen] = useState(false);
    const [browserTarget, setBrowserTarget] = useState<'dwi' | 'bval' | 'bvec' | 'anat' | 'json' | null>(null);
    const [browserPath, setBrowserPath] = useState('');
    const [browserItems, setBrowserItems] = useState<BrowseItem[]>([]);
    const [browserParent, setBrowserParent] = useState<string | null>(null);
    const [browserLoading, setBrowserLoading] = useState(false);
    const [browserError, setBrowserError] = useState<string | null>(null);
    const [lastBrowsedPath, setLastBrowsedPath] = useState('');

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [config, setConfig] = useState({
        skullStrippingMethod: 'median_otsu' as string,
        runEddy: true,
        eddyRepol: true,
        precomputeDTI: true,
    });

    // Eddy correction parameters
    const [phaseEncodeDir, setPhaseEncodeDir] = useState('j-');
    const [readoutTime, setReadoutTime] = useState('0.05');
    const [jsonFile, setJsonFile] = useState<File | null>(null);
    const [jsonPath, setJsonPath] = useState('');
    const [useJsonParams, setUseJsonParams] = useState(false);
    const [includeAnat, setIncludeAnat] = useState(false);
    const [includeJson, setIncludeJson] = useState(true);  // Default to preserving JSONs

    // Batch processing state
    const [batchRootPath, setBatchRootPath] = useState('');
    const [batchScanResult, setBatchScanResult] = useState<BatchScanResult | null>(null);
    const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(new Set());
    const [isScanning, setIsScanning] = useState(false);
    const [batchStatus, setBatchStatus] = useState<BatchProcessingStatus | null>(null);
    const [batchBrowserOpen, setBatchBrowserOpen] = useState(false);

    // HCP Zip mode state
    const [hcpZipPath, setHcpZipPath] = useState('');
    const [hcpZipScanResult, setHcpZipScanResult] = useState<HCPZipScanResult | null>(null);
    const [isHcpScanning, setIsHcpScanning] = useState(false);
    const [hcpBrowserOpen, setHcpBrowserOpen] = useState(false);

    // Poll batch status when running
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | null = null;

        const pollStatus = async () => {
            try {
                const status = await getBatchStatus();
                setBatchStatus(status);
                if (!status.is_running && batchStatus?.is_running) {
                    // Batch just completed
                    onProcessingStarted();
                }
            } catch (err) {
                console.error('Failed to fetch batch status:', err);
            }
        };

        if (inputMode === 'batch') {
            pollStatus();
            if (batchStatus?.is_running) {
                interval = setInterval(pollStatus, 2000);
            }
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [inputMode, batchStatus?.is_running, onProcessingStarted]);

    const handleFileChange = (setter: React.Dispatch<React.SetStateAction<File | null>>) => (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setter(e.target.files[0]);
        }
    };

    const toggleConfig = (key: keyof typeof config) => {
        setConfig(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const openFileBrowser = (target: 'dwi' | 'bval' | 'bvec' | 'anat' | 'json') => {
        setBrowserTarget(target);
        setBrowserOpen(true);
        // Start from last browsed path instead of root
        loadBrowserPath(lastBrowsedPath);
    };

    const loadBrowserPath = async (path: string) => {
        setBrowserLoading(true);
        setBrowserError(null);
        try {
            const result = await browseFiles(path);
            setBrowserPath(result.current_path);
            setBrowserParent(result.parent_path);
            setBrowserItems(result.items);
        } catch (err: any) {
            setBrowserError(err.message);
        } finally {
            setBrowserLoading(false);
        }
    };

    const handleBrowserItemClick = (item: BrowseItem) => {
        if (item.type === 'directory') {
            loadBrowserPath(item.path);
        } else {
            // File selected - remember the current directory for next time
            setLastBrowsedPath(browserPath);
            const setPath = {
                dwi: setDwiPath,
                bval: setBvalPath,
                bvec: setBvecPath,
                anat: setAnatPath,
                json: setJsonPath,
            }[browserTarget!];
            setPath(item.path);
            setBrowserOpen(false);
        }
    };

    // Batch processing functions
    const openBatchBrowser = () => {
        setBatchBrowserOpen(true);
        loadBrowserPath(batchRootPath || lastBrowsedPath);
    };

    const selectBatchDirectory = (path: string) => {
        setBatchRootPath(path);
        setBatchBrowserOpen(false);
        setBatchScanResult(null);
        setSelectedDatasets(new Set());
        setLastBrowsedPath(path);
    };

    const handleBatchScan = async () => {
        if (!batchRootPath) {
            setError('Please select a directory to scan');
            return;
        }
        setIsScanning(true);
        setError(null);
        setBatchScanResult(null);
        setSelectedDatasets(new Set());

        try {
            const result = await scanForDatasets(batchRootPath);
            setBatchScanResult(result);
            setSelectedDatasets(new Set(result.datasets.map(d => d.dwi_path)));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsScanning(false);
        }
    };

    const toggleDataset = (dwiPath: string) => {
        const newSelected = new Set(selectedDatasets);
        if (newSelected.has(dwiPath)) {
            newSelected.delete(dwiPath);
        } else {
            newSelected.add(dwiPath);
        }
        setSelectedDatasets(newSelected);
    };

    const toggleAllDatasets = () => {
        if (!batchScanResult) return;
        if (selectedDatasets.size === batchScanResult.datasets.length) {
            setSelectedDatasets(new Set());
        } else {
            setSelectedDatasets(new Set(batchScanResult.datasets.map(d => d.dwi_path)));
        }
    };

    const handleCancelBatch = async () => {
        try {
            await cancelBatchProcessing();
        } catch (err: any) {
            setError(err.message);
        }
    };

    // HCP Zip functions
    const handleModeChange = (mode: InputMode) => {
        setInputMode(mode);
        if (mode === 'hcp_zip') {
            setConfig(prev => ({ ...prev, runEddy: false }));
        }
    };

    const openHcpBrowser = () => {
        setHcpBrowserOpen(true);
        loadBrowserPath('');
    };

    const scanHcpZipPath = async (zipPath: string) => {
        setIsHcpScanning(true);
        setError(null);
        setHcpZipScanResult(null);
        try {
            const result = await scanHCPZip(zipPath);
            setHcpZipScanResult(result);
            if (!result.is_valid) {
                setError('Required diffusion files (DWI, bvals, bvecs) not found in zip. ' + (result.errors || []).join('; '));
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsHcpScanning(false);
        }
    };

    const selectHcpZipFile = (path: string) => {
        setHcpZipPath(path);
        setHcpBrowserOpen(false);
        setLastBrowsedPath(browserPath);
        scanHcpZipPath(path);
    };

    const handleHcpZipScan = () => {
        if (!hcpZipPath) return;
        scanHcpZipPath(hcpZipPath);
    };

    const getJobStatusIcon = (status: string) => {
        switch (status) {
            case 'pending': return <Square className="w-4 h-4 text-gray-400" />;
            case 'processing': return <Loader className="w-4 h-4 text-blue-500 animate-spin" />;
            case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />;
            case 'failed': return <XCircle className="w-4 h-4 text-red-500" />;
            default: return null;
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (inputMode === 'upload') {
            if (!dwiFile || !bvalFile || !bvecFile) {
                setError("DWI, BVAL, and BVEC files are required.");
                return;
            }
        } else if (inputMode === 'local') {
            if (!dwiPath || !bvalPath || !bvecPath) {
                setError("DWI, BVAL, and BVEC file paths are required.");
                return;
            }
        } else if (inputMode === 'batch') {
            if (!batchScanResult || selectedDatasets.size === 0) {
                setError("Please scan a directory and select datasets to process.");
                return;
            }
        } else if (inputMode === 'hcp_zip') {
            if (!hcpZipScanResult || !hcpZipScanResult.is_valid) {
                setError("Please scan a valid HCP zip file first.");
                return;
            }
        }

        setIsLoading(true);
        setError(null);

        try {
            if (inputMode === 'upload') {
                const formData = new FormData();
                formData.append('dwi_file', dwiFile!);
                formData.append('bval_file', bvalFile!);
                formData.append('bvec_file', bvecFile!);
                if (anatFile) formData.append('flair_file', anatFile);

                // Params
                formData.append('skull_stripping_method', config.skullStrippingMethod);
                formData.append('run_eddy', String(config.runEddy));
                formData.append('eddy_repol', String(config.eddyRepol));
                formData.append('phase_encode_dir', phaseEncodeDir);
                formData.append('readout_time', readoutTime);
                if (jsonFile) formData.append('json_file', jsonFile);
                formData.append('precompute_dti', String(config.precomputeDTI));

                await uploadAndProcess(formData);
                onProcessingStarted();
            } else if (inputMode === 'local') {
                await processLocalFiles({
                    dwi_path: dwiPath,
                    bval_path: bvalPath,
                    bvec_path: bvecPath,
                    flair_path: anatPath || undefined,
                    json_path: jsonPath || undefined,
                    skull_stripping_method: config.skullStrippingMethod,
                    run_eddy: config.runEddy,
                    eddy_repol: config.eddyRepol,
                    phase_encode_dir: phaseEncodeDir,
                    readout_time: parseFloat(readoutTime),
                    precompute_dti: config.precomputeDTI,
                });
                onProcessingStarted();
            } else if (inputMode === 'batch' || inputMode === 'hcp_zip') {
                // Batch and HCP-Zip flows were removed in 0.2; the buttons that
                // could put us in these modes are no longer rendered. This branch
                // is unreachable from the UI but kept so the discriminated union
                // is exhaustive.
                throw new Error(`Mode '${inputMode}' is not supported in dti-alps-refined 0.2.`);
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const getFileIcon = (item: BrowseItem) => {
        if (item.type === 'directory') {
            return <Folder className="w-4 h-4 text-yellow-500" />;
        }
        const ext = item.extension || '';
        if (item.name.toLowerCase().endsWith('.zip')) {
            return <Archive className="w-4 h-4 text-orange-500" />;
        }
        if (ext === '.gz' || ext === '.nii') {
            return <FileText className="w-4 h-4 text-green-500" />;
        }
        if (ext === '.bval' || ext === '.bvec') {
            return <FileText className="w-4 h-4 text-blue-500" />;
        }
        return <File className="w-4 h-4 text-gray-500" />;
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    return (
        <div className="p-6 max-w-2xl mx-auto bg-card rounded-xl border border-border">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-500" />
                Upload & Process
            </h2>

            {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-500 text-sm">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Input Mode Toggle */}
                <div className="flex gap-2 p-1 bg-secondary rounded-lg">
                    <button
                        type="button"
                        onClick={() => setInputMode('upload')}
                        disabled={batchStatus?.is_running}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                            inputMode === 'upload'
                                ? 'bg-blue-600 text-white'
                                : 'text-muted-foreground hover:text-foreground'
                        } ${batchStatus?.is_running ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <Globe className="w-4 h-4" />
                        Upload
                    </button>
                    <button
                        type="button"
                        onClick={() => setInputMode('local')}
                        disabled={batchStatus?.is_running}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${
                            inputMode === 'local'
                                ? 'bg-blue-600 text-white'
                                : 'text-muted-foreground hover:text-foreground'
                        } ${batchStatus?.is_running ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <FolderOpen className="w-4 h-4" />
                        Server Files
                    </button>
                </div>

                {inputMode === 'upload' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FileInput label="DWI Volume (.nii.gz)" onChange={handleFileChange(setDwiFile)} file={dwiFile} required />
                        <FileInput label="Anatomical (Optional)" onChange={handleFileChange(setAnatFile)} file={anatFile} />
                        <FileInput label="B-Values (.bval)" onChange={handleFileChange(setBvalFile)} file={bvalFile} required />
                        <FileInput label="B-Vectors (.bvec)" onChange={handleFileChange(setBvecFile)} file={bvecFile} required />
                    </div>
                )}

                {inputMode === 'local' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <PathInput label="DWI Volume (.nii.gz)" value={dwiPath} onBrowse={() => openFileBrowser('dwi')} required />
                        <PathInput label="Anatomical (Optional)" value={anatPath} onBrowse={() => openFileBrowser('anat')} />
                        <PathInput label="B-Values (.bval)" value={bvalPath} onBrowse={() => openFileBrowser('bval')} required />
                        <PathInput label="B-Vectors (.bvec)" value={bvecPath} onBrowse={() => openFileBrowser('bvec')} required />
                    </div>
                )}

                {inputMode === 'batch' && (
                    <div className="space-y-4">
                        {/* Directory Selection */}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={openBatchBrowser}
                                disabled={batchStatus?.is_running}
                                className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-lg border transition-colors ${
                                    batchRootPath
                                        ? 'bg-purple-500/10 border-purple-500/50 text-purple-400'
                                        : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
                                } ${batchStatus?.is_running ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <FolderOpen className="w-5 h-5" />
                                <span className="truncate text-left flex-1 text-sm">
                                    {batchRootPath || 'Select root directory...'}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={handleBatchScan}
                                disabled={!batchRootPath || isScanning || batchStatus?.is_running}
                                className="px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isScanning ? <Loader className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                                Scan
                            </button>
                        </div>

                        <p className="text-xs text-muted-foreground">
                            Select a root directory containing BIDS-formatted diffusion data (e.g., sub-XXX/ses-YYY/dwi/).
                        </p>

                        {/* Scan Results */}
                        {batchScanResult && !batchStatus?.is_running && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">
                                        Found {batchScanResult.total_found} datasets
                                    </span>
                                    <button
                                        type="button"
                                        onClick={toggleAllDatasets}
                                        className="text-sm text-purple-400 hover:text-purple-300"
                                    >
                                        {selectedDatasets.size === batchScanResult.datasets.length ? 'Deselect All' : 'Select All'}
                                    </button>
                                </div>

                                <div className="max-h-48 overflow-auto border border-border rounded-lg">
                                    {batchScanResult.datasets.map((dataset) => (
                                        <div
                                            key={dataset.dwi_path}
                                            onClick={() => toggleDataset(dataset.dwi_path)}
                                            className={`flex items-center gap-3 p-2 border-b border-border last:border-b-0 cursor-pointer transition-colors ${
                                                selectedDatasets.has(dataset.dwi_path) ? 'bg-purple-500/10' : 'hover:bg-secondary'
                                            }`}
                                        >
                                            {selectedDatasets.has(dataset.dwi_path) ? (
                                                <CheckSquare className="w-4 h-4 text-purple-500 flex-shrink-0" />
                                            ) : (
                                                <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium">
                                                    {dataset.subject_id}
                                                    {dataset.session_id && <span className="text-muted-foreground"> / {dataset.session_id}</span>}
                                                </div>
                                                <div className="text-xs text-muted-foreground truncate">{dataset.subfolder_path}</div>
                                            </div>
                                            {dataset.json_path && (
                                                <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">JSON</span>
                                            )}
                                            {dataset.anat_images?.flair && (
                                                <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">FLAIR</span>
                                            )}
                                            {dataset.anat_images?.t1 && (
                                                <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">T1</span>
                                            )}
                                            {dataset.anat_images?.t1post && (
                                                <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">T1+C</span>
                                            )}
                                            {dataset.anat_images?.t2 && (
                                                <span className="text-xs bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded">T2</span>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Batch BIDS Options */}
                                <div className="mt-3 p-3 bg-secondary/50 rounded-lg space-y-3">
                                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">BIDS Options</h4>

                                    {/* Include JSON Sidecars */}
                                    <div>
                                        <Checkbox
                                            label="Preserve JSON Sidecars"
                                            checked={includeJson}
                                            onChange={() => setIncludeJson(!includeJson)}
                                        />
                                        <p className="text-xs text-muted-foreground mt-1 ml-8">
                                            Copy acquisition metadata (scanner info, parameters) to output sessions.
                                            {batchScanResult.datasets.filter(d => d.json_path).length} of {batchScanResult.total_found} datasets have JSON files.
                                        </p>
                                    </div>

                                    {/* Include Anatomical Images Option */}
                                    {batchScanResult.datasets.some(d => d.anat_images && Object.keys(d.anat_images).length > 0) && (
                                        <div>
                                            <Checkbox
                                                label="Include Anatomical Images"
                                                checked={includeAnat}
                                                onChange={() => setIncludeAnat(!includeAnat)}
                                            />
                                            <p className="text-xs text-muted-foreground mt-1 ml-8">
                                                {(() => {
                                                    const counts: Record<string, number> = {};
                                                    batchScanResult.datasets.forEach(d => {
                                                        if (d.anat_images) {
                                                            Object.keys(d.anat_images).forEach(mod => {
                                                                counts[mod] = (counts[mod] || 0) + 1;
                                                            });
                                                        }
                                                    });
                                                    return Object.entries(counts)
                                                        .map(([mod, count]) => `${count} ${mod.toUpperCase()}`)
                                                        .join(', ');
                                                })()}.
                                                These can be used for registration in the multi-panel viewer.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Batch Progress */}
                        {batchStatus && batchStatus.jobs.length > 0 && (
                            <div className="space-y-3 p-4 bg-secondary/50 rounded-lg">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">Batch Progress</span>
                                    <span className="text-sm">
                                        {batchStatus.completed_jobs + batchStatus.failed_jobs} / {batchStatus.total_jobs}
                                    </span>
                                </div>

                                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-purple-500 transition-all"
                                        style={{ width: `${((batchStatus.completed_jobs + batchStatus.failed_jobs) / batchStatus.total_jobs) * 100}%` }}
                                    />
                                </div>

                                <div className="flex gap-4 text-xs">
                                    <span className="text-green-400">{batchStatus.completed_jobs} completed</span>
                                    <span className="text-red-400">{batchStatus.failed_jobs} failed</span>
                                    {batchStatus.is_running && (
                                        <span className="text-purple-400">Processing job {(batchStatus.current_job ?? 0) + 1}...</span>
                                    )}
                                </div>

                                <div className="max-h-32 overflow-auto border border-border rounded-lg">
                                    {batchStatus.jobs.map((job) => (
                                        <div
                                            key={job.dataset.dwi_path}
                                            className={`flex items-center gap-2 p-2 border-b border-border last:border-b-0 text-xs ${
                                                job.status === 'processing' ? 'bg-purple-500/10' : ''
                                            }`}
                                        >
                                            {getJobStatusIcon(job.status)}
                                            <span className="flex-1 truncate">
                                                {job.dataset.subject_id}{job.dataset.session_id && ` / ${job.dataset.session_id}`}
                                            </span>
                                            {job.error && <span className="text-red-400 truncate max-w-[150px]" title={job.error}>{job.error}</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {inputMode === 'hcp_zip' && (
                    <div className="space-y-4">
                        {/* Zip File Selection */}
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={openHcpBrowser}
                                className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-lg border transition-colors ${
                                    hcpZipPath
                                        ? 'bg-orange-500/10 border-orange-500/50 text-orange-400'
                                        : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <Archive className="w-5 h-5" />
                                <span className="truncate text-left flex-1 text-sm">
                                    {hcpZipPath ? hcpZipPath.replace(/\\/g, '/').split('/').pop() : 'Select HCP zip file...'}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={handleHcpZipScan}
                                disabled={!hcpZipPath.trim() || isHcpScanning}
                                className="px-4 py-3 bg-orange-600 hover:bg-orange-500 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {isHcpScanning ? <Loader className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                                Scan
                            </button>
                        </div>

                        {hcpZipPath && (
                            <div className="text-xs text-muted-foreground truncate" title={hcpZipPath}>
                                {hcpZipPath}
                            </div>
                        )}

                        <p className="text-xs text-muted-foreground">
                            Select an HCP-style zip file containing T1w/Diffusion/data.nii.gz, bvals, bvecs, and optionally T1w/T2w images.
                        </p>

                        {/* Scan Results */}
                        {hcpZipScanResult && (
                            <div className="p-4 bg-secondary/50 rounded-lg space-y-3">
                                <div className="flex items-center gap-2">
                                    <Archive className="w-5 h-5 text-orange-400" />
                                    <span className="font-medium">{hcpZipScanResult.subject_id}</span>
                                    {hcpZipScanResult.visit_id !== 'Unknown' && (
                                        <span className="text-muted-foreground">/ {hcpZipScanResult.visit_id}</span>
                                    )}
                                </div>

                                <div className="grid grid-cols-5 gap-2 text-xs">
                                    <div className={`flex items-center gap-1 p-1.5 rounded ${hcpZipScanResult.dwi_zip_path ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                        {hcpZipScanResult.dwi_zip_path ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                        <span>DWI</span>
                                    </div>
                                    <div className={`flex items-center gap-1 p-1.5 rounded ${hcpZipScanResult.bval_zip_path ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                        {hcpZipScanResult.bval_zip_path ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                        <span>bvals</span>
                                    </div>
                                    <div className={`flex items-center gap-1 p-1.5 rounded ${hcpZipScanResult.bvec_zip_path ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                                        {hcpZipScanResult.bvec_zip_path ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                        <span>bvecs</span>
                                    </div>
                                    <div className={`flex items-center gap-1 p-1.5 rounded ${hcpZipScanResult.t1_zip_path ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-500'}`}>
                                        {hcpZipScanResult.t1_zip_path ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                        <span>T1</span>
                                    </div>
                                    <div className={`flex items-center gap-1 p-1.5 rounded ${hcpZipScanResult.t2_zip_path ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-500'}`}>
                                        {hcpZipScanResult.t2_zip_path ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                        <span>T2</span>
                                    </div>
                                </div>

                                {/* Show internal paths */}
                                {hcpZipScanResult.is_valid && (
                                    <div className="text-xs text-muted-foreground space-y-0.5">
                                        <div className="truncate" title={hcpZipScanResult.dwi_zip_path || ''}>DWI: {hcpZipScanResult.dwi_zip_path}</div>
                                        {hcpZipScanResult.t1_zip_path && <div className="truncate" title={hcpZipScanResult.t1_zip_path}>T1: {hcpZipScanResult.t1_zip_path}</div>}
                                        {hcpZipScanResult.t2_zip_path && <div className="truncate" title={hcpZipScanResult.t2_zip_path}>T2: {hcpZipScanResult.t2_zip_path}</div>}
                                    </div>
                                )}

                                <div className="p-2 bg-orange-500/10 border border-orange-500/30 rounded text-xs text-orange-300">
                                    HCP data is typically already eddy-corrected. Eddy correction is disabled by default.
                                </div>

                                {hcpZipScanResult.errors.length > 0 && (
                                    <div className="text-xs text-red-400">
                                        {hcpZipScanResult.errors.map((err: string, i: number) => <div key={i}>{err}</div>)}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="space-y-3 pt-4 border-t border-border">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Processing Options</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg border bg-background border-border">
                            <label className="text-sm text-muted-foreground block mb-1">Skull Stripping</label>
                            <select
                                value={config.skullStrippingMethod}
                                onChange={(e) => setConfig(prev => ({ ...prev, skullStrippingMethod: e.target.value }))}
                                className="w-full bg-background border border-border rounded px-2 py-1 text-sm text-foreground"
                            >
                                <option value="median_otsu">Median Otsu (DIPY)</option>
                                <option value="bet">FSL BET</option>
                                <option value="none">None (pre-stripped)</option>
                            </select>
                        </div>
                        <Checkbox label="Run Eddy Correction" checked={config.runEddy} onChange={() => toggleConfig('runEddy')} />
                    </div>

                    {/* Eddy Correction Parameters - shown when eddy is enabled */}
                    {config.runEddy && (
                        <div className="mt-4 p-4 bg-secondary/50 rounded-lg space-y-4">
                            <h4 className="text-sm font-medium text-muted-foreground">Eddy Correction Settings</h4>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Checkbox label="Outlier Replacement (Repol)" checked={config.eddyRepol} onChange={() => toggleConfig('eddyRepol')} />

                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-muted-foreground">Phase Encode Direction</label>
                                    <select
                                        value={phaseEncodeDir}
                                        onChange={(e) => setPhaseEncodeDir(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border bg-secondary border-border text-foreground focus:outline-none focus:border-blue-500/50"
                                    >
                                        <option value="i">i (L→R)</option>
                                        <option value="i-">i- (R→L)</option>
                                        <option value="j">j (P→A)</option>
                                        <option value="j-">j- (A→P)</option>
                                        <option value="k">k (I→S)</option>
                                        <option value="k-">k- (S→I)</option>
                                    </select>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-sm font-medium text-muted-foreground">Total Readout Time (s)</label>
                                    <input
                                        type="number"
                                        step="0.001"
                                        min="0"
                                        value={readoutTime}
                                        onChange={(e) => setReadoutTime(e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg border bg-secondary border-border text-foreground focus:outline-none focus:border-blue-500/50"
                                        placeholder="0.05"
                                    />
                                </div>

                                {inputMode === 'upload' && (
                                    <FileInput
                                        label="JSON Sidecar (Optional)"
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                            if (e.target.files && e.target.files[0]) setJsonFile(e.target.files[0]);
                                        }}
                                        file={jsonFile}
                                    />
                                )}
                                {inputMode === 'local' && (
                                    <PathInput
                                        label="JSON Sidecar (Optional)"
                                        value={jsonPath}
                                        onBrowse={() => openFileBrowser('json')}
                                    />
                                )}
                                {inputMode === 'batch' && (
                                    <Checkbox
                                        label="Use JSON Params (if available)"
                                        checked={useJsonParams}
                                        onChange={() => setUseJsonParams(!useJsonParams)}
                                    />
                                )}
                            </div>

                            <p className="text-xs text-muted-foreground">
                                {inputMode === 'batch'
                                    ? 'Tip: Enable "Use JSON Params" to extract phase encoding and readout time from JSON sidecars (if they have correct values).'
                                    : 'Tip: If you provide a JSON sidecar file, phase encoding and readout time will be extracted automatically.'
                                }
                            </p>
                        </div>
                    )}
                </div>

                <div className="space-y-3 pt-4 border-t border-border">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Pre-computation</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Checkbox label="Standard DTI Maps" checked={config.precomputeDTI} onChange={() => toggleConfig('precomputeDTI')} />
                    </div>
                </div>

                {inputMode === 'batch' && batchStatus?.is_running ? (
                    <button
                        type="button"
                        onClick={handleCancelBatch}
                        className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                        <XCircle className="w-5 h-5" />
                        Cancel Batch
                    </button>
                ) : (
                    <button
                        type="submit"
                        disabled={
                            isLoading
                            || (inputMode === 'batch' && (!batchScanResult || selectedDatasets.size === 0))
                            || (inputMode === 'hcp_zip' && (!hcpZipScanResult || !hcpZipScanResult.is_valid))
                        }
                        className={`w-full py-3 ${
                            inputMode === 'batch' ? 'bg-purple-600 hover:bg-purple-500'
                            : inputMode === 'hcp_zip' ? 'bg-orange-600 hover:bg-orange-500'
                            : 'bg-blue-600 hover:bg-blue-500'
                        } text-white font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
                    >
                        {isLoading ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div> : <Play className="w-5 h-5" />}
                        {isLoading
                            ? (inputMode === 'upload' ? 'Uploading & Starting...' : 'Starting...')
                            : inputMode === 'batch'
                                ? `Process ${selectedDatasets.size} Dataset${selectedDatasets.size !== 1 ? 's' : ''}`
                                : inputMode === 'hcp_zip'
                                    ? 'Process HCP Zip'
                                    : 'Start Processing'
                        }
                    </button>
                )}
            </form>

            {/* File Browser Modal */}
            {browserOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setBrowserOpen(false)}>
                    <div className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <h3 className="font-semibold">Select File</h3>
                            <button onClick={() => setBrowserOpen(false)} className="p-1 hover:bg-secondary rounded">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-3 border-b border-border bg-secondary/50">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <FolderOpen className="w-4 h-4" />
                                <span className="truncate">{browserPath || '/'}</span>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-2">
                            {browserLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                                </div>
                            ) : browserError ? (
                                <div className="p-4 text-red-500 text-sm">{browserError}</div>
                            ) : (
                                <div className="space-y-1">
                                    {browserParent !== null && (
                                        <button
                                            onClick={() => loadBrowserPath(browserParent || '')}
                                            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary text-left"
                                        >
                                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                            <span className="text-sm text-muted-foreground">..</span>
                                        </button>
                                    )}
                                    {browserItems.map((item) => (
                                        <button
                                            key={item.path}
                                            onClick={() => handleBrowserItemClick(item)}
                                            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary text-left"
                                        >
                                            {getFileIcon(item)}
                                            <span className="text-sm flex-1 truncate">{item.name}</span>
                                            {item.type === 'file' && (
                                                <span className="text-xs text-muted-foreground">{formatSize(item.size)}</span>
                                            )}
                                        </button>
                                    ))}
                                    {browserItems.length === 0 && (
                                        <div className="p-4 text-center text-muted-foreground text-sm">
                                            No files found
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Batch Directory Browser Modal */}
            {batchBrowserOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setBatchBrowserOpen(false)}>
                    <div className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <h3 className="font-semibold">Select Directory</h3>
                            <button onClick={() => setBatchBrowserOpen(false)} className="p-1 hover:bg-secondary rounded">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-3 border-b border-border bg-secondary/50">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground flex-1 min-w-0">
                                    <FolderOpen className="w-4 h-4 flex-shrink-0" />
                                    <span className="truncate">{browserPath || '/'}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => selectBatchDirectory(browserPath)}
                                    className="ml-2 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded transition-colors"
                                >
                                    Select This
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-2">
                            {browserLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader className="w-6 h-6 animate-spin text-purple-500" />
                                </div>
                            ) : browserError ? (
                                <div className="p-4 text-red-500 text-sm">{browserError}</div>
                            ) : (
                                <div className="space-y-1">
                                    {browserParent !== null && (
                                        <button
                                            type="button"
                                            onClick={() => loadBrowserPath(browserParent || '')}
                                            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary text-left"
                                        >
                                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                            <span className="text-sm text-muted-foreground">..</span>
                                        </button>
                                    )}
                                    {browserItems
                                        .filter(item => item.type === 'directory')
                                        .map((item) => (
                                            <button
                                                type="button"
                                                key={item.path}
                                                onClick={() => loadBrowserPath(item.path)}
                                                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary text-left"
                                            >
                                                <Folder className="w-4 h-4 text-yellow-500" />
                                                <span className="text-sm truncate">{item.name}</span>
                                            </button>
                                        ))}
                                    {browserItems.filter(i => i.type === 'directory').length === 0 && (
                                        <div className="p-4 text-center text-muted-foreground text-sm">
                                            No subdirectories
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* HCP Zip File Browser Modal */}
            {hcpBrowserOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setHcpBrowserOpen(false)}>
                    <div className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <h3 className="font-semibold">Select HCP Zip File</h3>
                            <button onClick={() => setHcpBrowserOpen(false)} className="p-1 hover:bg-secondary rounded">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-3 border-b border-border bg-secondary/50">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <FolderOpen className="w-4 h-4" />
                                <span className="truncate">{browserPath || '/'}</span>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-2">
                            {browserLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Loader className="w-6 h-6 animate-spin text-orange-500" />
                                </div>
                            ) : browserError ? (
                                <div className="p-4 text-red-500 text-sm">{browserError}</div>
                            ) : (
                                <div className="space-y-1">
                                    {browserParent !== null && (
                                        <button
                                            type="button"
                                            onClick={() => loadBrowserPath(browserParent || '')}
                                            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary text-left"
                                        >
                                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                                            <span className="text-sm text-muted-foreground">..</span>
                                        </button>
                                    )}
                                    {browserItems
                                        .filter(item => {
                                            if (item.type !== 'directory' && !item.name.toLowerCase().endsWith('.zip')) return false;
                                            // At root level, hide the output directory
                                            if (!browserPath && item.path.replace(/\\/g, '/').endsWith('/dti_output')) return false;
                                            return true;
                                        })
                                        .map((item) => (
                                            <button
                                                type="button"
                                                key={item.path}
                                                onClick={() => {
                                                    if (item.type === 'directory') {
                                                        loadBrowserPath(item.path);
                                                    } else {
                                                        selectHcpZipFile(item.path);
                                                    }
                                                }}
                                                className={`w-full flex items-center gap-3 p-2 rounded-lg hover:bg-secondary text-left ${
                                                    item.type === 'file' ? 'hover:bg-orange-500/10' : ''
                                                }`}
                                            >
                                                {item.type === 'directory'
                                                    ? <Folder className="w-4 h-4 text-yellow-500" />
                                                    : <Archive className="w-4 h-4 text-orange-500" />
                                                }
                                                <span className="text-sm flex-1 truncate">{item.name}</span>
                                                {item.type === 'file' && (
                                                    <span className="text-xs text-muted-foreground">{formatSize(item.size)}</span>
                                                )}
                                            </button>
                                        ))}
                                    {browserItems.filter(item => {
                                        if (item.type !== 'directory' && !item.name.toLowerCase().endsWith('.zip')) return false;
                                        if (!browserPath && item.path.replace(/\\/g, '/').endsWith('/dti_output')) return false;
                                        return true;
                                    }).length === 0 && (
                                        <div className="p-4 text-center text-muted-foreground text-sm">
                                            No folders or zip files found
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const FileInput = ({ label, onChange, file, required }: any) => (
    <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">{label} {required && '*'}</label>
        <div className="relative">
            <input
                type="file"
                onChange={onChange}
                className="hidden"
                id={`file-${label}`}
            />
            <label
                htmlFor={`file-${label}`}
                className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg border cursor-pointer transition-colors ${file ? 'bg-blue-500/10 border-blue-500/50 text-blue-400' : 'bg-secondary border-border text-muted-foreground hover:text-foreground'}`}
            >
                <FileText className="w-4 h-4" />
                <span className="text-sm truncate">{file ? file.name : "Choose file..."}</span>
            </label>
        </div>
    </div>
);

const PathInput = ({ label, value, onBrowse, required }: {
    label: string;
    value: string;
    onBrowse: () => void;
    required?: boolean;
}) => (
    <div className="space-y-1">
        <label className="text-sm font-medium text-muted-foreground">{label} {required && '*'}</label>
        <button
            type="button"
            onClick={onBrowse}
            className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg border cursor-pointer transition-colors text-left ${value ? 'bg-blue-500/10 border-blue-500/50 text-blue-400' : 'bg-secondary border-border text-muted-foreground hover:text-foreground'}`}
        >
            <FolderOpen className="w-4 h-4" />
            <span className="text-sm truncate flex-1">{value ? value.split('/').pop() || value : "Browse..."}</span>
        </button>
    </div>
);

const Checkbox = ({ label, checked, onChange }: any) => (
    <div
        onClick={onChange}
        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${checked ? 'bg-blue-500/10 border-blue-500/50' : 'bg-background border-border hover:bg-secondary'}`}
    >
        {checked ? <CheckSquare className="w-5 h-5 text-blue-500" /> : <Square className="w-5 h-5 text-muted-foreground" />}
        <span className={`text-sm ${checked ? 'text-blue-100' : 'text-muted-foreground'}`}>{label}</span>
    </div>
);

export default ProcessingForm;
