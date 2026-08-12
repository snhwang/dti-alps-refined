import React, { useState } from 'react';
import { Upload, Activity, Clock, Brain } from 'lucide-react';
import Scene from './Scene';
import ProcessingForm from './components/ProcessingForm';
import StatusMonitor from './components/StatusMonitor';
import SessionManager from './components/SessionManager';
import ResultsViewer from './components/ResultsViewer';
import DTIALPSViewer from './components/DTIALPSViewer';
import type { Session } from './api';

type ViewMode = 'upload' | 'processing' | 'sessions' | 'viewer' | 'alps-viewer';

function App() {
  const [view, setView] = useState<ViewMode>('upload');
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);

  const handleProcessingStarted = () => {
    setView('processing');
  };

  const handleSelectSession = (session: Session) => {
    setSelectedSession(session);
    setView('viewer');
  };

  const handleBackToSessions = () => {
    setSelectedSession(null);
    setView('sessions');
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card p-4 flex flex-col gap-4">
        <div className="flex items-center gap-2 mb-6 px-2">
          <Brain className="h-8 w-8 text-blue-500" />
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            DTI-ALPS
          </h1>
        </div>

        <nav className="space-y-2">
          <Button
            icon={<Upload />}
            label="Upload & Process"
            active={view === 'upload'}
            onClick={() => setView('upload')}
          />
          <Button
            icon={<Activity />}
            label="Live Status"
            active={view === 'processing'}
            onClick={() => setView('processing')}
          />
          <Button
            icon={<Clock />}
            label="Session Manager"
            active={view === 'sessions'}
            onClick={() => setView('sessions')}
          />
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Top Bar */}
        <div className="h-14 border-b border-border flex items-center justify-between px-6 bg-card/50 backdrop-blur shrink-0">
          <div className="text-sm text-muted-foreground">Active View: <span className="text-foreground font-medium capitalize">{view}</span></div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-black/50 relative">

          {/* Background 3D Scene (dimmed when overlay is active) */}
          <div className="absolute inset-0 -z-10 opacity-30">
            <Scene />
          </div>

          <div className="p-6 h-full">
            {view === 'upload' && <ProcessingForm onProcessingStarted={handleProcessingStarted} />}
            {view === 'processing' && <StatusMonitor />}
            {view === 'sessions' && <SessionManager onSelectSession={handleSelectSession} />}
            {view === 'viewer' && selectedSession && (
              <ResultsViewer
                session={selectedSession}
                onBack={handleBackToSessions}
                onOpenALPSViewer={() => setView('alps-viewer')}
              />
            )}
          </div>

          {/* DTI-ALPS Viewer Overlay */}
          {view === 'alps-viewer' && selectedSession && (
            <DTIALPSViewer
              session={selectedSession}
              onClose={() => setView('viewer')}
            />
          )}

        </div>
      </div>
    </div>
  );
}

const Button = ({ icon, label, active, onClick }: any) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${active ? 'bg-primary text-primary-foreground shadow-lg shadow-blue-500/10' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
  >
    {React.cloneElement(icon, { size: 18 })}
    {label}
  </button>
);

export default App;
