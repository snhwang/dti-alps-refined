import { useEffect, useState, useRef, useMemo } from 'react';
import { Search, Folder, FolderOpen, FolderPlus, Trash2, ExternalLink, ChevronDown, ChevronRight, Save, X, Edit2, FileText, HardDrive, Settings, Activity, BarChart3, Download, Pencil } from 'lucide-react';
import { listSessions, deleteSession, updateSession, bulkMoveToFolder, exportAlpsTable } from '../api';
import type { Session } from '../api';

// ==================================================================================
// Prompt Modal – simple overlay for creating / renaming folders
// ==================================================================================

interface PromptModalProps {
    title: string;
    okLabel: string;
    defaultValue: string;
    onSubmit: (value: string) => void;
    onClose: () => void;
}

const PromptModal: React.FC<PromptModalProps> = ({ title, okLabel, defaultValue, onSubmit, onClose }) => {
    const [value, setValue] = useState(defaultValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const handleSubmit = () => {
        const trimmed = value.trim();
        if (trimmed) onSubmit(trimmed);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-card border border-border rounded-xl p-6 w-80 space-y-4" onClick={e => e.stopPropagation()}>
                <h3 className="font-medium text-lg">{title}</h3>
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onClose(); }}
                    placeholder="Folder name..."
                    className="w-full px-3 py-2 bg-secondary rounded-lg text-sm border-none focus:ring-2 ring-blue-500 outline-none"
                />
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-white transition-colors">Cancel</button>
                    <button onClick={handleSubmit} className="px-4 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors">{okLabel}</button>
                </div>
            </div>
        </div>
    );
};

// ==================================================================================
// Folder Sidebar Item
// ==================================================================================

interface FolderItemProps {
    label: string;
    count: number;
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    italic?: boolean;
    onRename?: () => void;
    onDelete?: () => void;
}

const FolderItem: React.FC<FolderItemProps> = ({ label, count, active, onClick, icon, italic, onRename, onDelete }) => (
    <div
        onClick={onClick}
        className={`group flex items-center justify-between px-4 py-2 cursor-pointer transition-all text-sm
            ${active
                ? 'bg-blue-500/10 border-l-[3px] border-l-cyan-400 text-foreground'
                : 'border-l-[3px] border-l-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground'
            }`}
    >
        <div className="flex items-center gap-2 overflow-hidden min-w-0">
            {icon}
            <span className={`truncate ${italic ? 'italic text-muted-foreground' : ''}`}>{label}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
            {onRename && (
                <button
                    onClick={e => { e.stopPropagation(); onRename(); }}
                    className="hidden group-hover:block p-1 hover:text-cyan-400 transition-colors"
                    title="Rename"
                >
                    <Pencil className="w-3 h-3" />
                </button>
            )}
            {onDelete && (
                <button
                    onClick={e => { e.stopPropagation(); onDelete(); }}
                    className="hidden group-hover:block p-1 hover:text-red-400 transition-colors"
                    title="Remove folder"
                >
                    <X className="w-3 h-3" />
                </button>
            )}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ml-1
                ${active ? 'bg-cyan-500/20 text-cyan-400' : 'bg-white/10 text-muted-foreground'}`}>
                {count}
            </span>
        </div>
    </div>
);

// ==================================================================================
// Folder Sidebar
// ==================================================================================

interface FolderSidebarProps {
    folderNames: string[];
    folderCounts: Record<string, number>;
    currentFolder: string | null;
    totalCount: number;
    onSelectFolder: (folder: string | null) => void;
    onCreateFolder: () => void;
    onRenameFolder: (name: string) => void;
    onDeleteFolder: (name: string) => void;
}

const FolderSidebar: React.FC<FolderSidebarProps> = ({
    folderNames, folderCounts, currentFolder, totalCount,
    onSelectFolder, onCreateFolder, onRenameFolder, onDeleteFolder,
}) => {
    const uncatCount = folderCounts[''] || 0;

    return (
        <div className="w-56 shrink-0 bg-card/50 border border-border rounded-xl overflow-y-auto flex flex-col">
            <div className="px-4 pt-4 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Folders
            </div>

            <FolderItem
                label="All Sessions"
                count={totalCount}
                active={currentFolder === null}
                onClick={() => onSelectFolder(null)}
                icon={<Folder className="w-4 h-4" />}
            />

            {folderNames.map(name => (
                <FolderItem
                    key={name}
                    label={name}
                    count={folderCounts[name] || 0}
                    active={currentFolder === name}
                    onClick={() => onSelectFolder(name)}
                    icon={<FolderOpen className="w-4 h-4" />}
                    onRename={() => onRenameFolder(name)}
                    onDelete={() => onDeleteFolder(name)}
                />
            ))}

            {uncatCount > 0 && (
                <FolderItem
                    label="Uncategorized"
                    count={uncatCount}
                    active={currentFolder === ''}
                    onClick={() => onSelectFolder('')}
                    icon={<Folder className="w-4 h-4 opacity-50" />}
                    italic
                />
            )}

            <div className="border-t border-border mx-4 my-2" />
            <button
                onClick={onCreateFolder}
                className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground hover:text-cyan-400 hover:bg-cyan-500/5 transition-colors w-full text-left"
            >
                <FolderPlus className="w-4 h-4" />
                New Folder
            </button>
        </div>
    );
};

// ==================================================================================
// Bulk Action Bar
// ==================================================================================

interface BulkActionBarProps {
    selectedCount: number;
    folderNames: string[];
    onMove: (folder: string) => void;
    onCreateAndMove: () => void;
    onClearSelection: () => void;
}

const BulkActionBar: React.FC<BulkActionBarProps> = ({
    selectedCount, folderNames, onMove, onCreateAndMove, onClearSelection,
}) => {
    const [targetFolder, setTargetFolder] = useState('');

    return (
        <div className="flex items-center gap-3 bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-2.5 mb-3">
            <span className="text-sm font-medium">{selectedCount} selected</span>
            <select
                value={targetFolder}
                onChange={e => {
                    if (e.target.value === '__new__') { onCreateAndMove(); return; }
                    setTargetFolder(e.target.value);
                }}
                className="px-3 py-1.5 bg-secondary border border-border rounded-lg text-sm focus:ring-2 ring-blue-500 outline-none"
            >
                <option value="">Uncategorized</option>
                {folderNames.map(f => <option key={f} value={f}>{f}</option>)}
                <option value="__new__">+ New Folder...</option>
            </select>
            <button
                onClick={() => onMove(targetFolder)}
                className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors"
            >
                Move
            </button>
            <button onClick={onClearSelection} className="ml-auto p-1.5 text-muted-foreground hover:text-white transition-colors">
                <X className="w-4 h-4" />
            </button>
        </div>
    );
};

// ==================================================================================
// Session Info Panel (expanded session details)
// ==================================================================================

interface SessionInfoPanelProps {
    session: Session;
    onUpdate: (session: Session) => void;
    folderNames: string[];
    onPromptNewFolder: (callback: (name: string) => void) => void;
}

const SessionInfoPanel: React.FC<SessionInfoPanelProps> = ({ session, onUpdate, folderNames, onPromptNewFolder }) => {
    const [isEditingNotes, setIsEditingNotes] = useState(false);
    const [notes, setNotes] = useState(session.description || '');
    const [saving, setSaving] = useState(false);

    const handleSaveNotes = async () => {
        setSaving(true);
        try {
            await updateSession(session.session_id, { description: notes });
            onUpdate({ ...session, description: notes });
            setIsEditingNotes(false);
        } catch (e) {
            alert('Failed to save notes');
        } finally {
            setSaving(false);
        }
    };

    const handleCancelEdit = () => {
        setNotes(session.description || '');
        setIsEditingNotes(false);
    };

    const handleFolderChange = async (value: string) => {
        if (value === '__new__') {
            onPromptNewFolder(async (name: string) => {
                try {
                    await updateSession(session.session_id, { folder: name });
                    onUpdate({ ...session, folder: name });
                } catch { alert('Failed to update folder'); }
            });
            return;
        }
        try {
            await updateSession(session.session_id, { folder: value });
            onUpdate({ ...session, folder: value });
        } catch { alert('Failed to update folder'); }
    };

    const hasSourcePaths = session.inputs?.dwi_path || session.inputs?.bval_path || session.inputs?.bvec_path;

    const formatTimestamp = (ts: string) => {
        if (!ts) return 'Unknown';
        const match = ts.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
        if (match) return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
        return ts;
    };

    return (
        <div className="mt-3 pt-3 border-t border-border space-y-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <Activity className="w-3 h-3" />
                        <span>Session ID</span>
                    </div>
                    <div className="text-sm font-mono text-foreground">{session.session_id}</div>
                </div>
                <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <Activity className="w-3 h-3" />
                        <span>Created</span>
                    </div>
                    <div className="text-sm text-foreground">{formatTimestamp(session.timestamp)}</div>
                </div>
            </div>

            {/* Folder Assignment */}
            <div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <Folder className="w-3 h-3" />
                    <span>Folder</span>
                </div>
                <select
                    value={session.folder || ''}
                    onChange={e => handleFolderChange(e.target.value)}
                    className="w-full px-3 py-2 bg-secondary rounded-lg text-sm border-none focus:ring-2 ring-blue-500 outline-none"
                >
                    <option value="">Uncategorized</option>
                    {folderNames.map(f => <option key={f} value={f}>{f}</option>)}
                    <option value="__new__">+ New Folder...</option>
                </select>
            </div>

            {/* Acquisition Info */}
            {session.acquisition && Object.keys(session.acquisition).length > 0 && (
                <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <Activity className="w-3 h-3" />
                        <span>Acquisition</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {session.acquisition.total_volumes !== undefined && (
                            <div className="bg-secondary/50 rounded-lg p-2">
                                <div className="text-xs text-muted-foreground">Volumes</div>
                                <div className="text-sm font-medium">{session.acquisition.total_volumes}</div>
                            </div>
                        )}
                        {session.acquisition.num_diffusion_directions !== undefined && (
                            <div className="bg-secondary/50 rounded-lg p-2">
                                <div className="text-xs text-muted-foreground">Directions</div>
                                <div className="text-sm font-medium">{session.acquisition.num_diffusion_directions}</div>
                            </div>
                        )}
                        {session.acquisition.num_b0_volumes !== undefined && (
                            <div className="bg-secondary/50 rounded-lg p-2">
                                <div className="text-xs text-muted-foreground">B0 Volumes</div>
                                <div className="text-sm font-medium">{session.acquisition.num_b0_volumes}</div>
                            </div>
                        )}
                        {session.acquisition.shells && session.acquisition.shells.length > 0 && (
                            <div className="bg-secondary/50 rounded-lg p-2">
                                <div className="text-xs text-muted-foreground">Shells</div>
                                <div className="text-sm font-medium">{session.acquisition.shells.join(', ')}</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Source File Paths (only for local file sessions) */}
            {hasSourcePaths && (
                <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <HardDrive className="w-3 h-3" />
                        <span>Source Files</span>
                    </div>
                    <div className="bg-secondary/30 rounded-lg p-3 space-y-2 font-mono text-xs">
                        {session.inputs?.dwi_path && (
                            <div className="flex">
                                <span className="text-muted-foreground w-16 shrink-0">DWI:</span>
                                <span className="text-foreground break-all">{session.inputs.dwi_path}</span>
                            </div>
                        )}
                        {session.inputs?.bval_path && (
                            <div className="flex">
                                <span className="text-muted-foreground w-16 shrink-0">BVAL:</span>
                                <span className="text-foreground break-all">{session.inputs.bval_path}</span>
                            </div>
                        )}
                        {session.inputs?.bvec_path && (
                            <div className="flex">
                                <span className="text-muted-foreground w-16 shrink-0">BVEC:</span>
                                <span className="text-foreground break-all">{session.inputs.bvec_path}</span>
                            </div>
                        )}
                        {session.inputs?.flair_path && (
                            <div className="flex">
                                <span className="text-muted-foreground w-16 shrink-0">FLAIR:</span>
                                <span className="text-foreground break-all">{session.inputs.flair_path}</span>
                            </div>
                        )}
                        {session.inputs?.t1post_path && (
                            <div className="flex">
                                <span className="text-muted-foreground w-16 shrink-0">T1:</span>
                                <span className="text-foreground break-all">{session.inputs.t1post_path}</span>
                            </div>
                        )}
                        {session.inputs?.json_path && (
                            <div className="flex">
                                <span className="text-muted-foreground w-16 shrink-0">JSON:</span>
                                <span className="text-foreground break-all">{session.inputs.json_path}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Input Files (for uploaded sessions) */}
            {!hasSourcePaths && session.inputs && Object.values(session.inputs).some(v => v) && (
                <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <FileText className="w-3 h-3" />
                        <span>Input Files</span>
                    </div>
                    <div className="bg-secondary/30 rounded-lg p-3 space-y-1 text-xs">
                        {session.inputs?.dwi_filename && <div className="text-foreground">{session.inputs.dwi_filename}</div>}
                        {session.inputs?.bval_filename && <div className="text-foreground">{session.inputs.bval_filename}</div>}
                        {session.inputs?.bvec_filename && <div className="text-foreground">{session.inputs.bvec_filename}</div>}
                        {session.inputs?.flair_filename && <div className="text-foreground">{session.inputs.flair_filename}</div>}
                        {session.inputs?.t1post_filename && <div className="text-foreground">{session.inputs.t1post_filename}</div>}
                    </div>
                </div>
            )}

            {/* Processing Parameters */}
            {session.parameters && Object.keys(session.parameters).length > 0 && (
                <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <Settings className="w-3 h-3" />
                        <span>Processing Parameters</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {session.parameters.run_eddy && (
                            <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs rounded">Eddy Corrected</span>
                        )}
                        {session.parameters.eddy_repol && (
                            <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs rounded">Eddy Repol</span>
                        )}
                        {session.parameters.skull_stripping_method && session.parameters.skull_stripping_method !== 'median_otsu' && (
                            <span className="px-2 py-1 bg-yellow-500/10 text-yellow-400 text-xs rounded">
                                {session.parameters.skull_stripping_method === 'bet' ? 'BET' : 'No Skull Strip'}
                            </span>
                        )}
                        {session.parameters.precompute_dti && (
                            <span className="px-2 py-1 bg-green-500/10 text-green-400 text-xs rounded">DTI</span>
                        )}
                        {session.parameters.precompute_model_free && (
                            <span className="px-2 py-1 bg-green-500/10 text-green-400 text-xs rounded">Model-Free</span>
                        )}
                        {session.parameters.precompute_sh && (
                            <span className="px-2 py-1 bg-green-500/10 text-green-400 text-xs rounded">SH</span>
                        )}
                        {session.parameters.precompute_needlet && (
                            <span className="px-2 py-1 bg-green-500/10 text-green-400 text-xs rounded">Needlet</span>
                        )}
                        {session.parameters.phase_encode_dir && (
                            <span className="px-2 py-1 bg-secondary text-muted-foreground text-xs rounded">PE: {session.parameters.phase_encode_dir}</span>
                        )}
                    </div>
                </div>
            )}

            {/* Available Files */}
            {session.available_files && Object.keys(session.available_files).length > 0 && (
                <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <FileText className="w-3 h-3" />
                        <span>Available Outputs</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {Object.entries(session.available_files).map(([key, available]) => (
                            <span
                                key={key}
                                className={`px-2 py-1 text-xs rounded ${available
                                        ? 'bg-green-500/10 text-green-400'
                                        : 'bg-secondary text-muted-foreground opacity-50'
                                    }`}
                            >
                                {key.replace(/_/g, ' ')}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* ALPS Results */}
            {session.alps_results && (
                <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <BarChart3 className="w-3 h-3" />
                        <span>DTI-ALPS Results</span>
                        <span className="text-muted-foreground/60">
                            ({new Date(session.alps_results.timestamp).toLocaleString()})
                        </span>
                    </div>
                    <div className="bg-secondary/30 rounded-lg p-3 space-y-3">
                        {/* Parameters */}
                        <div className="flex gap-3 text-xs">
                            <span className="text-muted-foreground">FA Threshold:</span>
                            <span className="font-medium">{session.alps_results.fa_threshold?.toFixed(2) ?? 'N/A'}</span>
                            <span className="text-muted-foreground ml-2">Hemisphere:</span>
                            <span className="font-medium capitalize">{session.alps_results.hemisphere}</span>
                        </div>

                        {/* Combined/Main Results */}
                        {(session.alps_results.classic != null ||
                          session.alps_results.refined != null ||
                          session.alps_results.refined_plus != null ||
                          session.alps_results.alps_pas != null) && (
                            <div>
                                <div className="text-xs font-medium text-muted-foreground mb-2">
                                    {session.alps_results.hemisphere === 'both' ? 'Combined' : 'Results'}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {session.alps_results.classic != null && (
                                        <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2">
                                            <div className="text-xs text-muted-foreground">Classic</div>
                                            <div className="text-sm font-bold">{session.alps_results.classic.toFixed(3)}</div>
                                        </div>
                                    )}
                                    {session.alps_results.refined != null && (
                                        <div className="bg-purple-500/10 border border-purple-500/20 rounded p-2">
                                            <div className="text-xs text-muted-foreground">Refined</div>
                                            <div className="text-sm font-bold">{session.alps_results.refined.toFixed(3)}</div>
                                        </div>
                                    )}
                                    {session.alps_results.refined_plus != null && (
                                        <div className="bg-pink-500/10 border border-pink-500/20 rounded p-2">
                                            <div className="text-xs text-muted-foreground">Refined+</div>
                                            <div className="text-sm font-bold">{session.alps_results.refined_plus.toFixed(3)}</div>
                                        </div>
                                    )}
                                    {session.alps_results.alps_pas != null && (
                                        <div className="bg-cyan-500/10 border border-cyan-500/20 rounded p-2">
                                            <div className="text-xs text-muted-foreground">ALPS-PAS</div>
                                            <div className="text-sm font-bold text-cyan-400">{session.alps_results.alps_pas.toFixed(3)}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Per-Hemisphere Results */}
                        {(session.alps_results.left || session.alps_results.right) && (
                            <div className="grid grid-cols-2 gap-3">
                                {session.alps_results.left && (
                                    <div>
                                        <div className="text-xs font-medium text-blue-400 mb-2">Left Hemisphere</div>
                                        <div className="space-y-1.5">
                                            {session.alps_results.left.classic != null && (
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">Classic:</span>
                                                    <span className="font-bold">{session.alps_results.left.classic.toFixed(3)}</span>
                                                </div>
                                            )}
                                            {session.alps_results.left.refined != null && (
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">Refined:</span>
                                                    <span className="font-bold">{session.alps_results.left.refined.toFixed(3)}</span>
                                                </div>
                                            )}
                                            {session.alps_results.left.refined_plus != null && (
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">Refined+:</span>
                                                    <span className="font-bold">{session.alps_results.left.refined_plus.toFixed(3)}</span>
                                                </div>
                                            )}
                                            {session.alps_results.left.alps_pas != null && (
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">ALPS-PAS:</span>
                                                    <span className="font-bold text-cyan-400">{session.alps_results.left.alps_pas.toFixed(3)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {session.alps_results.right && (
                                    <div>
                                        <div className="text-xs font-medium text-purple-400 mb-2">Right Hemisphere</div>
                                        <div className="space-y-1.5">
                                            {session.alps_results.right.classic != null && (
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">Classic:</span>
                                                    <span className="font-bold">{session.alps_results.right.classic.toFixed(3)}</span>
                                                </div>
                                            )}
                                            {session.alps_results.right.refined != null && (
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">Refined:</span>
                                                    <span className="font-bold">{session.alps_results.right.refined.toFixed(3)}</span>
                                                </div>
                                            )}
                                            {session.alps_results.right.refined_plus != null && (
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">Refined+:</span>
                                                    <span className="font-bold">{session.alps_results.right.refined_plus.toFixed(3)}</span>
                                                </div>
                                            )}
                                            {session.alps_results.right.alps_pas != null && (
                                                <div className="flex justify-between text-xs">
                                                    <span className="text-muted-foreground">ALPS-PAS:</span>
                                                    <span className="font-bold text-cyan-400">{session.alps_results.right.alps_pas.toFixed(3)}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Notes Section */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FileText className="w-3 h-3" />
                        <span>Notes</span>
                    </div>
                    {!isEditingNotes && (
                        <button
                            onClick={() => setIsEditingNotes(true)}
                            className="p-1 hover:bg-white/10 rounded text-muted-foreground hover:text-white transition-colors"
                            title="Edit notes"
                        >
                            <Edit2 className="w-3 h-3" />
                        </button>
                    )}
                </div>
                {isEditingNotes ? (
                    <div className="space-y-2">
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Add notes about this session..."
                            className="w-full h-24 bg-secondary rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 ring-blue-500"
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={handleCancelEdit}
                                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-white transition-colors flex items-center gap-1"
                            >
                                <X className="w-3 h-3" />
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveNotes}
                                disabled={saving}
                                className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
                            >
                                <Save className="w-3 h-3" />
                                {saving ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div
                        onClick={() => setIsEditingNotes(true)}
                        className="bg-secondary/30 rounded-lg p-3 text-sm text-foreground min-h-[60px] cursor-pointer hover:bg-secondary/50 transition-colors"
                    >
                        {session.description || <span className="text-muted-foreground italic">Click to add notes...</span>}
                    </div>
                )}
            </div>
        </div>
    );
};

// ==================================================================================
// Session Manager (main component)
// ==================================================================================

interface SessionManagerProps {
    onSelectSession?: (session: Session) => void;
}

const SessionManager: React.FC<SessionManagerProps> = ({ onSelectSession }) => {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
    const [showExportDialog, setShowExportDialog] = useState(false);
    const [exportFormat, setExportFormat] = useState<'csv' | 'tsv'>('csv');
    const [participantsFile, setParticipantsFile] = useState<File | null>(null);
    const [exporting, setExporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Folder state
    const [currentFolder, setCurrentFolder] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [manualFolders, setManualFolders] = useState<Set<string>>(new Set());
    const [promptModal, setPromptModal] = useState<{
        title: string;
        okLabel: string;
        defaultValue: string;
        onSubmit: (value: string) => void;
    } | null>(null);

    // Derived folder data
    const folderCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        sessions.forEach(s => {
            const f = s.folder || '';
            counts[f] = (counts[f] || 0) + 1;
        });
        return counts;
    }, [sessions]);

    const folderNames = useMemo(() => {
        const fromSessions = Object.keys(folderCounts).filter(f => f !== '');
        const all = new Set([...fromSessions, ...manualFolders]);
        return [...all].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    }, [folderCounts, manualFolders]);

    // Filtering: folder + search
    const filteredSessions = useMemo(() => {
        let result = sessions;

        if (currentFolder !== null) {
            result = result.filter(s => (s.folder || '') === currentFolder);
        }

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            result = result.filter(s =>
                s.name.toLowerCase().includes(term) ||
                s.session_id.toLowerCase().includes(term) ||
                (s.description || '').toLowerCase().includes(term) ||
                (s.folder || '').toLowerCase().includes(term)
            );
        }

        return result;
    }, [sessions, currentFolder, searchTerm]);

    const fetchSessions = async () => {
        try {
            setLoading(true);
            const data = await listSessions();
            setSessions(data.sessions.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')));
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchSessions(); }, []);

    // Clear selection when folder changes
    useEffect(() => { setSelectedIds(new Set()); }, [currentFolder]);

    // ---- Session handlers ----

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm("Are you sure you want to delete this session?")) return;
        try {
            await deleteSession(id);
            setSessions(prev => prev.filter(s => s.session_id !== id));
            setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
            if (expandedSessionId === id) setExpandedSessionId(null);
        } catch (e) {
            alert("Failed to delete session");
        }
    };

    const handleSessionUpdate = (updatedSession: Session) => {
        setSessions(prev => prev.map(s =>
            s.session_id === updatedSession.session_id ? updatedSession : s
        ));
    };

    const toggleExpanded = (sessionId: string) => {
        setExpandedSessionId(prev => prev === sessionId ? null : sessionId);
    };

    // ---- Folder handlers ----

    const handleRenameFolder = (oldName: string) => {
        setPromptModal({
            title: 'Rename Folder',
            okLabel: 'Rename',
            defaultValue: oldName,
            onSubmit: async (newName: string) => {
                if (!newName || newName === oldName) return;
                const ids = sessions.filter(s => (s.folder || '') === oldName).map(s => s.session_id);
                if (ids.length === 0) return;
                try {
                    await bulkMoveToFolder(ids, newName);
                    setSessions(prev => prev.map(s =>
                        ids.includes(s.session_id) ? { ...s, folder: newName } : s
                    ));
                    if (currentFolder === oldName) setCurrentFolder(newName);
                } catch { alert('Error renaming folder'); }
            },
        });
    };

    const handleDeleteFolder = async (name: string) => {
        if (!window.confirm(`Remove folder "${name}"? Sessions will be moved to Uncategorized.`)) return;
        const ids = sessions.filter(s => (s.folder || '') === name).map(s => s.session_id);
        if (ids.length > 0) {
            try {
                await bulkMoveToFolder(ids, '');
                setSessions(prev => prev.map(s =>
                    ids.includes(s.session_id) ? { ...s, folder: '' } : s
                ));
            } catch { alert('Error removing folder'); return; }
        }
        setManualFolders(prev => { const next = new Set(prev); next.delete(name); return next; });
        if (currentFolder === name) setCurrentFolder(null);
    };

    const handleBulkMove = async (folder: string) => {
        if (selectedIds.size === 0) return;
        try {
            await bulkMoveToFolder([...selectedIds], folder);
            setSessions(prev => prev.map(s =>
                selectedIds.has(s.session_id) ? { ...s, folder } : s
            ));
            setSelectedIds(new Set());
        } catch { alert('Error moving sessions'); }
    };

    const openCreateFolderPrompt = (afterCreate?: (name: string) => void) => {
        setPromptModal({
            title: 'New Folder',
            okLabel: 'Create',
            defaultValue: '',
            onSubmit: (name: string) => {
                setManualFolders(prev => new Set([...prev, name]));
                if (afterCreate) {
                    afterCreate(name);
                } else if (selectedIds.size > 0) {
                    handleBulkMove(name);
                }
                setCurrentFolder(name);
            },
        });
    };

    const toggleSelectSession = (sessionId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(sessionId)) next.delete(sessionId);
            else next.add(sessionId);
            return next;
        });
    };

    // ---- Export handler ----

    const handleExport = async () => {
        setExporting(true);
        try {
            const blob = await exportAlpsTable(exportFormat, participantsFile || undefined);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `alps_results.${exportFormat}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setShowExportDialog(false);
            setParticipantsFile(null);
        } catch (e: any) {
            alert(e.message || 'Failed to export ALPS table');
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold">Session Manager</h2>
                    <button
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg text-sm transition-colors"
                        onClick={() => setShowExportDialog(true)}
                        title="Export ALPS results table"
                    >
                        <Download className="w-4 h-4" />
                        Export ALPS Table
                    </button>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search sessions..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="pl-9 pr-4 py-2 bg-secondary rounded-lg text-sm border-none focus:ring-2 ring-blue-500 outline-none w-64"
                    />
                </div>
            </div>

            {/* Export dialog */}
            {showExportDialog && (
                <div className="mx-6 mb-4 bg-card border border-border rounded-xl p-4 space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="font-medium">Export ALPS Results</h3>
                        <button
                            className="p-1 hover:bg-white/10 rounded text-muted-foreground hover:text-white transition-colors"
                            onClick={() => { setShowExportDialog(false); setParticipantsFile(null); }}
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex items-center gap-4">
                        <label className="text-sm text-muted-foreground">Format:</label>
                        <div className="flex gap-2">
                            <button
                                className={`px-3 py-1 rounded text-sm transition-colors ${exportFormat === 'csv' ? 'bg-blue-500 text-white' : 'bg-secondary text-muted-foreground hover:text-white'}`}
                                onClick={() => setExportFormat('csv')}
                            >CSV</button>
                            <button
                                className={`px-3 py-1 rounded text-sm transition-colors ${exportFormat === 'tsv' ? 'bg-blue-500 text-white' : 'bg-secondary text-muted-foreground hover:text-white'}`}
                                onClick={() => setExportFormat('tsv')}
                            >TSV</button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-muted-foreground">Participants file (optional, for demographics):</label>
                        <div className="flex items-center gap-3">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".tsv,.csv,.txt"
                                className="hidden"
                                onChange={e => setParticipantsFile(e.target.files?.[0] || null)}
                            />
                            <button
                                className="px-3 py-1.5 bg-secondary hover:bg-white/10 rounded text-sm text-muted-foreground hover:text-white transition-colors"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <FileText className="w-4 h-4 inline mr-1.5" />
                                {participantsFile ? participantsFile.name : 'Select file...'}
                            </button>
                            {participantsFile && (
                                <button
                                    className="text-xs text-muted-foreground hover:text-red-400"
                                    onClick={() => { setParticipantsFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                                >Clear</button>
                            )}
                        </div>
                    </div>

                    <button
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                        onClick={handleExport}
                        disabled={exporting}
                    >
                        {exporting ? 'Exporting...' : 'Export'}
                    </button>
                </div>
            )}

            {/* Main body: sidebar + content */}
            <div className="flex-1 flex overflow-hidden px-6 pb-6 gap-4">
                {/* Folder Sidebar */}
                <FolderSidebar
                    folderNames={folderNames}
                    folderCounts={folderCounts}
                    currentFolder={currentFolder}
                    totalCount={sessions.length}
                    onSelectFolder={setCurrentFolder}
                    onCreateFolder={() => openCreateFolderPrompt()}
                    onRenameFolder={handleRenameFolder}
                    onDeleteFolder={handleDeleteFolder}
                />

                {/* Session List */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Bulk action bar */}
                    {selectedIds.size > 0 && (
                        <BulkActionBar
                            selectedCount={selectedIds.size}
                            folderNames={folderNames}
                            onMove={handleBulkMove}
                            onCreateAndMove={() => openCreateFolderPrompt((name) => handleBulkMove(name))}
                            onClearSelection={() => setSelectedIds(new Set())}
                        />
                    )}

                    <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                        {loading ? (
                            <div className="text-center py-10 text-muted-foreground">Loading sessions...</div>
                        ) : filteredSessions.length === 0 ? (
                            <div className="text-center py-10 text-muted-foreground">
                                {currentFolder !== null && sessions.length > 0
                                    ? 'No sessions in this folder.'
                                    : 'No sessions found.'
                                }
                            </div>
                        ) : (
                            filteredSessions.map(session => {
                                const isExpanded = expandedSessionId === session.session_id;
                                const isSelected = selectedIds.has(session.session_id);
                                return (
                                    <div
                                        key={session.session_id}
                                        className={`bg-card border p-4 rounded-xl transition-all ${
                                            isSelected
                                                ? 'border-cyan-500/50 bg-cyan-500/5'
                                                : isExpanded
                                                    ? 'border-blue-500/50'
                                                    : 'border-border hover:border-blue-500/30'
                                        }`}
                                    >
                                        <div
                                            className="flex items-center justify-between cursor-pointer group"
                                            onClick={() => toggleExpanded(session.session_id)}
                                        >
                                            <div className="flex items-center gap-3">
                                                {/* Checkbox */}
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleSelectSession(session.session_id)}
                                                    onClick={e => e.stopPropagation()}
                                                    className="w-4 h-4 rounded border-border accent-blue-500 shrink-0"
                                                />
                                                <button className="text-muted-foreground hover:text-white transition-colors">
                                                    {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                                                </button>
                                                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
                                                    <Folder className="w-5 h-5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="font-medium text-foreground flex items-center gap-2">
                                                        <span className="truncate">{session.name}</span>
                                                        {currentFolder === null && session.folder && (
                                                            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 shrink-0">
                                                                {session.folder}
                                                            </span>
                                                        )}
                                                    </h3>
                                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                        <span>{session.session_id}</span>
                                                        <span>•</span>
                                                        <span>{session.timestamp}</span>
                                                        {session.description && (
                                                            <>
                                                                <span>•</span>
                                                                <span className="text-blue-400 truncate max-w-[200px]" title={session.description}>
                                                                    {session.description.length > 30 ? session.description.slice(0, 30) + '...' : session.description}
                                                                </span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                <button
                                                    className="p-2 hover:bg-white/10 rounded-lg text-muted-foreground hover:text-white transition-colors"
                                                    title="Open in Viewer"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onSelectSession?.(session);
                                                    }}
                                                >
                                                    <ExternalLink className="w-4 h-4" />
                                                </button>
                                                <button
                                                    className="p-2 hover:bg-red-500/20 rounded-lg text-muted-foreground hover:text-red-400 transition-colors"
                                                    onClick={(e) => handleDelete(session.session_id, e)}
                                                    title="Delete Session"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>

                                        {isExpanded && (
                                            <SessionInfoPanel
                                                session={session}
                                                onUpdate={handleSessionUpdate}
                                                folderNames={folderNames}
                                                onPromptNewFolder={(callback) => openCreateFolderPrompt(callback)}
                                            />
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Prompt Modal */}
            {promptModal && (
                <PromptModal
                    title={promptModal.title}
                    okLabel={promptModal.okLabel}
                    defaultValue={promptModal.defaultValue}
                    onSubmit={promptModal.onSubmit}
                    onClose={() => setPromptModal(null)}
                />
            )}
        </div>
    );
};

export default SessionManager;
