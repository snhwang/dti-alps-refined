import { useEffect, useState } from 'react';
import { Activity, CheckCircle, AlertTriangle, XCircle, Terminal } from 'lucide-react';
import { checkStatus } from '../api';
import type { ProcessingStatus } from '../api';

const StatusMonitor = () => {
    const [status, setStatus] = useState<ProcessingStatus | null>(null);
    const [polling, setPolling] = useState(true);

    useEffect(() => {
        let interval: any;
        if (polling) {
            interval = setInterval(async () => {
                try {
                    const data = await checkStatus();
                    setStatus(data);

                    if (!data.is_processing && (data.error || data.results)) {
                        setPolling(false);
                    }
                } catch (e) {
                    // Silently fail on poll error
                }
            }, 2000);
        }
        return () => clearInterval(interval);
    }, [polling]);

    if (!status) return null;

    const isSuccess = !status.is_processing && status.results;
    const isError = !status.is_processing && status.error;

    return (
        <div className="p-6 max-w-2xl mx-auto bg-card rounded-xl border border-border mt-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                    {status.is_processing && <Activity className="w-5 h-5 text-blue-400 animate-pulse" />}
                    {isSuccess && <CheckCircle className="w-5 h-5 text-green-500" />}
                    {isError && <XCircle className="w-5 h-5 text-red-500" />}
                    Status Monitor
                </h3>
                <span className="text-xs font-mono text-muted-foreground">
                    {status.is_processing ? "LIVE" : "DONE"}
                </span>
            </div>

            <div className="space-y-4">
                {/* Progress Bar */}
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-500 ${isSuccess ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-blue-500'}`}
                        style={{ width: `${status.progress}%` }}
                    />
                </div>

                {/* Console Log Area */}
                <div className="bg-black/50 rounded-lg p-4 border border-border/50 font-mono text-sm max-h-60 overflow-y-auto">
                    <div className="flex items-start gap-2 text-blue-300">
                        <Terminal className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{status.current_step}</span>
                    </div>
                    {isError && (
                        <div className="flex items-start gap-2 text-red-400 mt-2">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>Error: {status.error}</span>
                        </div>
                    )}
                    {isSuccess && (
                        <div className="flex items-start gap-2 text-green-400 mt-2">
                            <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>Processing completed successfully.</span>
                        </div>
                    )}
                    {status.warnings?.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 text-amber-400 mt-2">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{w}</span>
                        </div>
                    ))}
                </div>

                {/* Results Info */}
                {isSuccess && status.results && (
                    <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                        <h4 className="font-bold text-green-400 mb-2">Analysis Results</h4>
                        <ul className="text-sm space-y-1 text-green-200/80">
                            <li>Total Volumes: {status.results.total_volumes}</li>
                            <li>Unique B-Values: {status.results.num_unique_bvals}</li>
                            <li>Directions: {status.results.num_diffusion_directions}</li>
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StatusMonitor;
