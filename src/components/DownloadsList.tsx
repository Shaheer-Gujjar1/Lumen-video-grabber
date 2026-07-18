import { Progress } from "@/components/ui/progress";
import { useEffect } from "react";
import { Download, CheckCircle2, XCircle, FolderOpen, Trash2, RefreshCw, FileVideo, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

import { invoke } from "@tauri-apps/api/core";

interface DownloadItem {
  id: string;
  title: string;
  percent: number;
  speed: string;
  status: 'downloading' | 'completed' | 'error' | 'paused';
  path: string;
  url: string;
  thumbnail?: string;
  error?: string;
  total_size?: string;
}

interface DownloadsListProps {
  downloads: DownloadItem[];
  onDelete: (id: string, path: string) => void;
  onRedownload: (url: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onFetchThumbnail?: (id: string, path: string) => void;
}

const DownloadsList = ({ downloads, onDelete, onRedownload, onPause, onResume, onFetchThumbnail }: DownloadsListProps) => {
  const handleOpenFolder = async (path: string) => {
    try {
      await invoke("open_file_location", { path });
    } catch (e) {
      console.error("Failed to open file location:", e);
    }
  };

  if (downloads.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground animate-in fade-in zoom-in duration-500">
      <Download className="w-12 h-12 mb-4 opacity-20" />
      <p className="text-sm">Your download history is empty</p>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="grid grid-cols-1 gap-4">
        {downloads.map((dl) => (
          <div key={dl.id} className="p-5 rounded-[2rem] glass-card hover:bg-white/10 transition-all duration-500 group relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            
            <div className="flex items-start gap-6 relative z-10">
              {!dl.thumbnail && dl.status === 'completed' && dl.path && (
                <ThumbnailFetcher id={dl.id} path={dl.path} onFetch={onFetchThumbnail} />
              )}
              {dl.thumbnail ? (
                <div className="shrink-0 w-32 h-20 rounded-2xl overflow-hidden bg-black/40 border border-white/10 shadow-2xl relative group-hover:scale-105 transition-transform duration-500">
                  <img 
                    src={dl.thumbnail} 
                    alt="" 
                    className="w-full h-full object-cover absolute inset-0" 
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://www.youtube.com/favicon.ico';
                    }}
                  />
                  {dl.status === 'downloading' && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="shrink-0 w-32 h-20 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5 relative group-hover:scale-105 transition-transform duration-500">
                  <div className="absolute inset-0 bg-primary/5 animate-pulse" />
                  <FileVideo className="w-8 h-8 text-white/10" />
                </div>
              )}
              <div className="flex-1 min-w-0 pt-1">
                <h3 className="text-lg font-display font-bold text-white truncate leading-tight tracking-tight flex items-center gap-2">
                  <FileVideo className="w-5 h-5 text-primary opacity-80 shrink-0" />
                  {dl.title}
                </h3>
                <div className="flex items-center gap-3 mt-2">
                  {dl.status === 'downloading' ? (
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 border border-primary/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
                        {dl.speed}
                      </span>
                    </div>
                  ) : dl.status === 'completed' ? (
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
                        Saved
                      </span>
                    </div>
                  ) : dl.status === 'paused' ? (
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
                      <Pause className="w-3.5 h-3.5 text-amber-500" />
                      <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">
                        Paused
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-destructive/10 border border-destructive/20">
                      <XCircle className="w-3.5 h-3.5 text-destructive" />
                      <span className="text-[10px] font-bold text-destructive uppercase tracking-widest">Failed</span>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-2 pt-1">
                {dl.status === 'completed' && (
                  <Button
                    variant="ghost" 
                    size="icon"
                    onClick={() => handleOpenFolder(dl.path)}
                    className="h-10 w-10 rounded-xl neon-btn"
                    title="Reveal File"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </Button>
                )}
                
                {dl.status === 'downloading' && (
                  <Button
                    variant="ghost" 
                    size="icon"
                    onClick={() => onPause(dl.id)}
                    className="h-10 w-10 rounded-xl bg-white/5 hover:bg-amber-500/20 hover:text-amber-500 transition-all duration-300"
                    title="Pause Download"
                  >
                    <Pause className="w-4 h-4" />
                  </Button>
                )}

                {dl.status === 'paused' && (
                  <Button
                    variant="ghost" 
                    size="icon"
                    onClick={() => onResume(dl.id)}
                    className="h-10 w-10 rounded-xl bg-white/5 hover:bg-emerald-500/20 hover:text-emerald-500 transition-all duration-300"
                    title="Resume Download"
                  >
                    <Play className="w-4 h-4 ml-0.5" />
                  </Button>
                )}

                {dl.status !== 'downloading' && dl.status !== 'paused' && (
                  <Button
                    variant="ghost" 
                    size="icon"
                    onClick={() => onRedownload(dl.url)}
                    className="h-10 w-10 rounded-xl neon-btn"
                    title="Acquire Again"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                )}

                <Button
                  variant="ghost" 
                  size="icon"
                  onClick={() => onDelete(dl.id, dl.path)}
                  className="h-10 w-10 rounded-xl neon-btn-destructive"
                  title="Expunge Record"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
            
            {(dl.status === 'downloading' || dl.status === 'paused') && (
              <div className="mt-6 space-y-2 relative z-10">
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                    <div 
                        className={`h-full transition-all duration-500 ease-out relative ${dl.status === 'paused' ? 'bg-amber-500' : 'premium-gradient'}`}
                        style={{ width: `${dl.percent}%` }}
                    >
                        {dl.status === 'downloading' && <div className="absolute inset-0 bg-white/20 animate-pulse" />}
                    </div>
                </div>
                <div className="flex justify-between items-center px-1">
                  <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">
                    {(() => {
                      if (!dl.total_size) return dl.speed;
                      const totalClean = dl.total_size.replace(/[^\d.]/g, "");
                      const unit = dl.total_size.replace(/[\d.]/g, "").trim();
                      const totalNum = parseFloat(totalClean);
                      if (isNaN(totalNum)) return dl.total_size;
                      const downloaded = (totalNum * (dl.percent / 100)).toFixed(2);
                      return `${downloaded}${unit} / ${dl.total_size}`;
                    })()}
                  </span>
                  <span className="text-xs font-mono text-primary font-bold">{Math.round(dl.percent)}%</span>
                </div>
              </div>
            )}
            
            {dl.error && <p className="text-xs text-destructive font-medium mt-3 px-1">{dl.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
};

const ThumbnailFetcher = ({ id, path, onFetch }: { id: string, path: string, onFetch?: (id: string, path: string) => void }) => {
  useEffect(() => {
    if (onFetch) {
      onFetch(id, path);
    }
  }, [id, path, onFetch]);
  return null;
};

export default DownloadsList;
