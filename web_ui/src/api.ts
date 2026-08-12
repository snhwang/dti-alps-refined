export interface ProcessingStatus {
    is_processing: boolean;
    current_step: string;
    progress: number;
    error?: string;
    warnings?: string[];
    results?: any;
}

export interface SessionAcquisition {
    unique_bvals?: number[];
    shells?: number[];  // Non-b0 shells only
    num_b0_volumes?: number;
    num_diffusion_directions?: number;
    total_volumes?: number;
}

export interface SessionInputs {
    dwi_filename?: string;
    bval_filename?: string;
    bvec_filename?: string;
    flair_filename?: string;
    t1post_filename?: string;
    json_filename?: string;
    // Source paths for local file processing
    dwi_path?: string;
    bval_path?: string;
    bvec_path?: string;
    flair_path?: string;
    t1post_path?: string;
    json_path?: string;
}

export interface SessionParameters {
    skull_stripping_method?: string;
    run_eddy?: boolean;
    eddy_repol?: boolean;
    phase_encode_dir?: string;
    readout_time?: number;
    precompute_dti?: boolean;
    // Legacy flags read from older sessions; not produced by this UI.
    precompute_model_free?: boolean;
    precompute_sh?: boolean;
    precompute_needlet?: boolean;
}

export interface Session {
    session_id: string;
    timestamp: string;
    name: string;
    description: string;
    folder: string;
    inputs: SessionInputs;
    parameters: SessionParameters;
    acquisition?: SessionAcquisition;
    available_files: Record<string, boolean>;
    dir?: string;
    alps_results?: {
        timestamp: string;
        hemisphere: string;
        fa_threshold: number;
        classic?: number;
        refined?: number;
        refined_plus?: number;
        alps_pas?: number;
        left?: {
            classic?: number;
            refined?: number;
            refined_plus?: number;
            alps_pas?: number;
        };
        right?: {
            classic?: number;
            refined?: number;
            refined_plus?: number;
            alps_pas?: number;
        };
    };
}

export interface ALPSROICoords {
    x_min: number;
    x_max: number;
    y_min: number;
    y_max: number;
    z_slice: number;
}

export interface ALPSClassicResult {
    alps_index: number;
    Dx_proj: number;
    Dx_assoc: number;
    Dy_proj: number;
    Dz_assoc: number;
}

export interface ALPSOrientationAwareResult {
    alps_index: number | null;
    error?: string;
    D_pvs_proj?: number;
    D_pvs_assoc?: number;
    D_orth_proj?: number;
    D_orth_assoc?: number;
    v_proj: number[];
    v_assoc: number[];
    d_pvs?: number[];
    o_proj?: number[];
    o_assoc?: number[];
    theta_deg?: number;  // Angle QC metric
}

export interface ALPSRefinedLocalResult {
    alps_index: number;
    D_pvs_proj: number;
    D_pvs_assoc: number;
    D_orth_proj: number;
    D_orth_assoc: number;
    d_pvs: number[];
    o_proj: number[];
    o_assoc: number[];
    R: number;  // Dispersion measure (FA-weighted resultant length)
    delta_phi_deg: number;  // Agreement angle with cross-product axis
}

// ALPS-PAS (Ajouz et al. 2026) - Principal Axis System method
export interface ALPSPASResult {
    alps_index: number;
    lambda_x_proj: number;       // λ_x in projection ROI (more x-aligned radial eigenvalue)
    lambda_x_assoc: number;      // λ_x in association ROI
    lambda_nonx_proj: number;    // λ_y/nonx in projection ROI (less x-aligned radial eigenvalue)
    lambda_nonx_assoc: number;   // λ_z/nonx in association ROI
    description?: string;
}

export interface ALPSHemisphereResult {
    hemisphere: string;
    roi_stats: {
        proj_voxels: number;
        assoc_voxels: number;
        proj_mean_fa: number;
        assoc_mean_fa: number;
    };
    classic?: ALPSClassicResult;
    orientation_aware?: ALPSOrientationAwareResult;
    refined_local?: ALPSRefinedLocalResult;
    alps_pas?: ALPSPASResult;
}

export interface ALPSResults {
    session_id: string;
    method: string;
    fa_threshold: number;
    fa_cap_percentile?: number;
    hemisphere: string;
    roi_proj: ALPSROICoords | { type: string; pen_value: number };
    roi_assoc: ALPSROICoords | { type: string; pen_value: number };
    // Combined results (for backwards compatibility)
    roi_stats?: {
        proj_voxels: number;
        assoc_voxels: number;
        proj_mean_fa: number;
        assoc_mean_fa: number;
    };
    classic?: ALPSClassicResult;
    orientation_aware?: ALPSOrientationAwareResult;
    refined_local?: ALPSRefinedLocalResult;
    alps_pas?: ALPSPASResult;  // ALPS-PAS (Ajouz et al. 2026)
    // Per-hemisphere results
    left?: ALPSHemisphereResult;
    right?: ALPSHemisphereResult;
    // ROI persistence
    rois_saved?: boolean;
    rois_path?: string;
}

// Saved ALPS ROIs response
export interface SavedALPSRois {
    has_rois: boolean;
    message?: string;
    mask_data?: number[];
    dims?: number[];
    metadata?: {
        timestamp: string;
        pen_proj: number;
        pen_assoc: number;
        fa_threshold: number;
        fa_cap_percentile?: number;
        hemisphere: string;
        dims: number[];
        roi_stats: {
            proj_voxels_total: number;
            assoc_voxels_total: number;
            proj_voxels_fa_filtered: number;
            assoc_voxels_fa_filtered: number;
        };
    };
}

export const checkStatus = async (): Promise<ProcessingStatus> => {
    const response = await fetch('/status');
    if (!response.ok) throw new Error('Failed to fetch status');
    return response.json();
};

export const listSessions = async (): Promise<{ sessions: Session[] }> => {
    const response = await fetch('/sessions/list');
    if (!response.ok) throw new Error('Failed to fetch sessions');
    return response.json();
};

export const deleteSession = async (sessionId: string) => {
    const response = await fetch(`/sessions/${sessionId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete session');
    return response.json();
};

export const updateSession = async (sessionId: string, updates: { name?: string; description?: string; folder?: string }) => {
    const params = new URLSearchParams();
    if (updates.name !== undefined) params.append('name', updates.name);
    if (updates.description !== undefined) params.append('description', updates.description);
    if (updates.folder !== undefined) params.append('folder', updates.folder);

    const response = await fetch(`/sessions/${sessionId}?${params.toString()}`, { method: 'PUT' });
    if (!response.ok) throw new Error('Failed to update session');
    return response.json();
};

export const bulkMoveToFolder = async (sessionIds: string[], folder: string) => {
    const response = await fetch('/sessions/bulk_move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_ids: sessionIds, folder }),
    });
    if (!response.ok) throw new Error('Failed to move sessions');
    return response.json();
};

export const getAlpsRois = async (sessionId: string): Promise<SavedALPSRois> => {
    const response = await fetch(`/sessions/${sessionId}/alps_rois`);
    if (!response.ok) throw new Error('Failed to fetch ALPS ROIs');
    return response.json();
};

export interface SavedALPSResults {
    has_results: boolean;
    message?: string;
    session_id?: string;
    alps_results?: {
        timestamp: string;
        hemisphere: string;
        fa_threshold: number;
        classic?: number;
        refined?: number;
        refined_plus?: number;
        alps_pas?: number;
        left?: {
            classic?: number;
            refined?: number;
            refined_plus?: number;
            alps_pas?: number;
        };
        right?: {
            classic?: number;
            refined?: number;
            refined_plus?: number;
            alps_pas?: number;
        };
    };
}

export const getAlpsResults = async (sessionId: string): Promise<SavedALPSResults> => {
    const response = await fetch(`/sessions/${sessionId}/alps_results`);
    if (!response.ok) throw new Error('Failed to fetch ALPS results');
    return response.json();
};

export const exportAlpsTable = async (format: string, participantsFile?: File): Promise<Blob> => {
    const formData = new FormData();
    formData.append('format', format);
    if (participantsFile) {
        formData.append('participants_file', participantsFile);
    }
    const response = await fetch('/export_alps_table', {
        method: 'POST',
        body: formData,
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to export ALPS table');
    }
    return response.blob();
};

export const uploadAndProcess = async (formData: FormData) => {
    const response = await fetch('/process_dti', {
        method: 'POST',
        body: formData,
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Processing failed');
    }
    return response.json();
};

export interface LocalProcessingParams {
    dwi_path: string;
    bval_path: string;
    bvec_path: string;
    flair_path?: string;
    t1post_path?: string;
    json_path?: string;
    skull_stripping_method?: string;
    run_eddy?: boolean;
    eddy_repol?: boolean;
    phase_encode_dir?: string;
    readout_time?: number;
    precompute_dti?: boolean;
}

export const processLocalFiles = async (params: LocalProcessingParams) => {
    const response = await fetch('/process_dti_local', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Processing failed');
    }
    return response.json();
};

export interface BrowseItem {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size: number;
    extension?: string;
}

export interface BrowseResult {
    current_path: string;
    parent_path: string | null;
    items: BrowseItem[];
}

export const browseFiles = async (path: string = ''): Promise<BrowseResult> => {
    const response = await fetch(`/browse_files?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to browse files');
    }
    return response.json();
};

// ==================================================================================
// Stubs for legacy batch / HCP UI removed in 0.2.
// ProcessingForm.tsx still references these symbols but the buttons that call
// them are no longer rendered, so the call sites are unreachable. Kept as
// throwing stubs so the file compiles; remove once ProcessingForm is rewritten.
// ==================================================================================

export interface BatchScanResult {
    root_path: string;
    datasets: any[];
    total_found: number;
}
export interface BatchProcessingStatus {
    is_running: boolean;
    total_jobs: number;
    completed_jobs: number;
    failed_jobs: number;
    current_job?: number;
    jobs: any[];
}
export interface HCPZipScanResult {
    zip_path: string;
    is_valid: boolean;
    [k: string]: any;
}

const _removed = (name: string) => {
    throw new Error(`${name} is not available in dti-alps-refined 0.2 (batch/HCP processing was removed).`);
};
export const scanForDatasets = async (_root: string): Promise<BatchScanResult> => _removed('scanForDatasets');
export const startBatchProcessing = async (..._args: any[]) => _removed('startBatchProcessing');
export const getBatchStatus = async (): Promise<BatchProcessingStatus> => _removed('getBatchStatus');
export const cancelBatchProcessing = async () => _removed('cancelBatchProcessing');
export const scanHCPZip = async (_zip: string): Promise<HCPZipScanResult> => _removed('scanHCPZip');
export const processHCPZip = async (..._args: any[]) => _removed('processHCPZip');
