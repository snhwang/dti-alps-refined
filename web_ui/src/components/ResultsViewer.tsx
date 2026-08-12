import { ArrowLeft, Download, FileText, Layers, Activity } from 'lucide-react';
import type { Session } from '../api';

interface ResultsViewerProps {
    session: Session;
    onBack: () => void;
    onOpenALPSViewer?: () => void;
}

const ResultsViewer: React.FC<ResultsViewerProps> = ({ session, onBack, onOpenALPSViewer }) => {
    // Helper to get file URL
    const getUrl = (filename: string) => `/files/${session.session_id}/processed/${filename}`;

    return (
        <div className="h-full flex flex-col p-6 bg-black/40 backdrop-blur-md text-white overflow-y-auto">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <button
                    onClick={onBack}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                    <ArrowLeft className="w-6 h-6" />
                </button>
                <div>
                    <h2 className="text-2xl font-bold">{session.name || "Untitled Session"} <span className="text-sm font-normal text-blue-400 border border-blue-400/30 px-2 py-0.5 rounded-full ml-2">React Viewer v1.0</span></h2>
                    <div className="text-sm text-gray-400 flex gap-4">
                        <span>ID: {session.session_id}</span>
                        <span>•</span>
                        <span>{session.timestamp}</span>
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Generated Maps Card */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                    <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                        <Layers className="w-5 h-5 text-blue-400" />
                        Generated Maps
                    </h3>
                    <div className="space-y-2">
                        {session.available_files?.['processed/fa.nii.gz'] && (
                            <FileRow name="Fractional Anisotropy (FA)" filename="fa.nii.gz" getUrl={getUrl} />
                        )}
                        {session.available_files?.['processed/md.nii.gz'] && (
                            <FileRow name="Mean Diffusivity (MD)" filename="md.nii.gz" getUrl={getUrl} />
                        )}
                        {session.available_files?.['processed/ad.nii.gz'] && (
                            <FileRow name="Axial Diffusivity (AD)" filename="ad.nii.gz" getUrl={getUrl} />
                        )}
                        {session.available_files?.['processed/rd.nii.gz'] && (
                            <FileRow name="Radial Diffusivity (RD)" filename="rd.nii.gz" getUrl={getUrl} />
                        )}
                        {/* Fallback if no specific maps found */}
                        {!session.available_files?.['processed/fa.nii.gz'] && !session.available_files?.['processed/md.nii.gz'] && (
                            <div className="text-gray-500 italic">No standard maps found.</div>
                        )}
                    </div>
                </div>

                {/* Visualization Actions */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                    <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                        <Activity className="w-5 h-5 text-blue-400" />
                        Visualization & Tools
                    </h3>
                    <p className="text-gray-400 mb-6 text-sm">
                        Launch interactive viewers for detailed analysis.
                    </p>

                    <div className="space-y-3">
                        <button
                            className="w-full py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-lg font-bold shadow-lg shadow-green-500/20 transition-all flex items-center justify-center gap-2"
                            onClick={onOpenALPSViewer}
                        >
                            <Activity className="w-5 h-5" />
                            Launch DTI-ALPS Tool
                        </button>
                    </div>
                </div>
            </div>

            {/* Inputs & Parameters (Collapsible or reduced) */}
            <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-400">
                    <FileText className="w-4 h-4" />
                    Session Details
                </h3>
                <pre className="bg-black/50 p-4 rounded-lg text-xs font-mono text-gray-500 overflow-x-auto border border-white/5">
                    {JSON.stringify(session.parameters, null, 2)}
                </pre>
            </div>
        </div>
    );
};

const FileRow = ({ name, filename, getUrl }: any) => (
    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors group">
        <span className="font-medium text-sm">{name}</span>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <a
                href={getUrl(filename)}
                download
                className="p-1.5 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/40"
                title="Download"
            >
                <Download className="w-4 h-4" />
            </a>
        </div>
    </div>
);

export default ResultsViewer;
