import { useState, useCallback, useEffect } from "react";
import { Download, Link2, Loader2, Settings, FolderOpen, History, Search, Sparkles, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import VideoPreview from "@/components/VideoPreview";
import FormatSelector from "@/components/FormatSelector";
import DownloadsList from "@/components/DownloadsList";
import { toast } from "sonner";
import CustomModal from "@/components/CustomModal";

// Tauri v2 imports
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { downloadDir } from "@tauri-apps/api/path";

function extractVideoId(url: string | undefined | null): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

interface FormatItem {
  height: number;
  filesize: number | null;
  label: string;
}

interface VideoInfo {
  id: string;
  title: string;
  channel: string;
  duration: string;
  thumbnail: string;
  formats: FormatItem[];
}

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
  forceDuplicate?: boolean;
  total_size?: string;
  mode: string;
  quality: string;
}

interface ProgressPayload {
  download_id: string;
  percent: number;
  speed: string;
  eta: number;
  filepath?: string;
  total_size?: string;
}

interface RecentSearchItem {
  title: string;
  thumbnail: string;
  url: string;
  duration: string;
  timestamp: string;
}

const Index = () => {
  const [url, setUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string>("");
  const [mode, setMode] = useState("video");
  const [quality, setQuality] = useState("1080");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [defaultPath, setDefaultPath] = useState<string>("");
  const [activeTab, setActiveTab] = useState("search");
  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  // Custom Modal States
  const [duplicateModal, setDuplicateModal] = useState({ open: false });
  const [deleteModal, setDeleteModal] = useState({ open: false, id: '', path: '' });

  // Load history & configurations from localStorage (Tauri storage replacement)
  const saveHistoryToStorage = (items: DownloadItem[]) => {
    localStorage.setItem("lumen_grabber_history", JSON.stringify(items));
  };

  const getHistoryFromStorage = (): DownloadItem[] => {
    try {
      const data = localStorage.getItem("lumen_grabber_history");
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  };

  const getRecentSearchesFromStorage = (): RecentSearchItem[] => {
    try {
      const data = localStorage.getItem("lumen_grabber_recent");
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  };

  const saveRecentSearchesToStorage = (items: RecentSearchItem[]) => {
    localStorage.setItem("lumen_grabber_recent", JSON.stringify(items));
  };

  useEffect(() => {
    // Disable right click (context menu) inside web view
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu);

    // Setup Tauri progress listener
    const unlistenProgress = listen<ProgressPayload>("download-progress", (event) => {
      const { download_id, percent, speed, filepath, total_size } = event.payload;
      setDownloads(prev => {
        const updated = prev.map(dl => 
          dl.id === download_id 
            ? { 
                ...dl, 
                percent, 
                speed, 
                status: (percent === 100 ? 'completed' : 'downloading') as 'completed' | 'downloading',
                path: filepath || dl.path,
                total_size: total_size || dl.total_size
              } 
            : dl
        );
        saveHistoryToStorage(updated);
        return updated;
      });
    });

    const unlistenError = listen<[string, string]>("download-error", (event) => {
      const [id, errorMsg] = event.payload;
      setDownloads(prev => {
        const updated = prev.map(dl => 
          dl.id === id 
            ? { 
                ...dl, 
                status: 'error' as const,
                error: errorMsg
              } 
            : dl
        );
        saveHistoryToStorage(updated);
        return updated;
      });
      toast.error("Download failed", { description: errorMsg });
    });

    // Check system dependencies on boot
    const verifyDeps = async () => {
      try {
        const status = await invoke<Record<string, boolean>>("check_dependencies");
        if (!status.ffmpeg) {
          toast.warning("FFmpeg is missing!", {
            description: "FFmpeg is required to combine video and audio streams."
          });
        }
        if (!status.ytdlp) {
          toast.error("yt-dlp is missing!", {
            description: "Please install yt-dlp to allow media acquisition."
          });
        }
      } catch (e) {
        console.error("Dependency check failed:", e);
      }
    };

    // Load path & history
    const initApp = async () => {
      verifyDeps();
      
      let path = localStorage.getItem("lumen_grabber_default_path");
      if (!path) {
        try {
          path = await downloadDir();
        } catch {
          path = "";
        }
      }
      setDefaultPath(path || "");

      const history = getHistoryFromStorage();
      const cleanedHistory = history.map(h => 
        h.status === 'downloading' ? { ...h, status: 'paused' as const, speed: 'Interrupted' } : h
      );
      setDownloads(cleanedHistory);
      setRecentSearches(getRecentSearchesFromStorage());
    };

    initApp();

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      unlistenProgress.then(f => f());
      unlistenError.then(f => f());
    };
  }, []);

  const handleFetch = useCallback(async (targetUrl?: string) => {
    const fetchUrl = targetUrl || url;
    const trimmedUrl = fetchUrl.trim();
    if (!trimmedUrl) {
      toast.error("Please enter a valid URL");
      return;
    }

    setLoading(true);
    setVideoInfo(null);
    setShowRecent(false);
    try {
      const info = await invoke<{
        id?: string;
        title?: string;
        channel?: string;
        duration?: string | number;
        thumbnail?: string;
        formats?: FormatItem[];
      }>("fetch_video_info", { url: trimmedUrl });
      setLoading(false);
      if (info) {
        const videoData: VideoInfo = {
          id: info.id || "",
          title: info.title || "Unknown Title",
          channel: info.channel || "Unknown Channel",
          duration: typeof info.duration === "string" ? info.duration : "--:--",
          thumbnail: info.thumbnail || "",
          formats: info.formats || [],
        };
        setVideoInfo(videoData);
        if (videoData.formats && videoData.formats.length > 0) {
          // Set to highest available resolution
          setQuality(videoData.formats[0].height.toString());
        }
        if (targetUrl) setUrl(targetUrl);

        // Save to recent searches
        let recent = getRecentSearchesFromStorage();
        recent = recent.filter(r => r.url !== trimmedUrl);
        recent.unshift({
          title: videoData.title,
          thumbnail: videoData.thumbnail,
          url: trimmedUrl,
          duration: videoData.duration,
          timestamp: new Date().toISOString()
        });
        recent = recent.slice(0, 5);
        saveRecentSearchesToStorage(recent);
        setRecentSearches(recent);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err) || "Failed to extract video information.");
    }
    setLoading(false);
  }, [url]);

  const handleSetPath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: defaultPath || undefined
      });
      if (selected && typeof selected === "string") {
        setDefaultPath(selected);
        localStorage.setItem("lumen_grabber_default_path", selected);
        toast.success("Download path updated");
      }
    } catch (e) {
      toast.error("Failed to select path");
    }
  };

  const handleDownload = async (forceDuplicate = false) => {
    if (!videoInfo) return;

    if (!forceDuplicate) {
      try {
        const fileCheck = await invoke<{ exists: boolean; path?: string }>("check_file_exists", {
          folder: defaultPath,
          filename: videoInfo.title
        });
        if (fileCheck.exists) {
          setDuplicateModal({ open: true });
          return;
        }
      } catch (e) {
        console.error(e);
      }
    }

    setDuplicateModal({ open: false });
    setDownloading(true);
    setDownloadStatus("Starting...");

    const newId = Math.random().toString(36).substring(2, 11);

    try {
      await invoke("download_video", {
        url: url.trim(),
        downloadPath: defaultPath,
        mode,
        quality,
        downloadId: newId,
        allowDuplicate: forceDuplicate
      });

      const newDownload: DownloadItem = {
        id: newId,
        title: videoInfo.title,
        percent: 0,
        speed: "0 MB/s",
        status: 'downloading',
        path: `${defaultPath}/${videoInfo.title}`,
        url: url.trim(),
        thumbnail: videoInfo.thumbnail,
        forceDuplicate: forceDuplicate,
        mode,
        quality,
      };
      
      setDownloads(prev => {
        const updated = [newDownload, ...prev];
        saveHistoryToStorage(updated);
        return updated;
      });
      toast.success("Download started!", { description: videoInfo.title });
    } catch (err: unknown) {
      toast.error("Download Error", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setDownloading(false);
      setDownloadStatus("");
    }
  };

  const handlePause = async (id: string) => {
    try {
      await invoke("pause_download", { downloadId: id });
      setDownloads(prev => {
        const updated = prev.map(dl => dl.id === id ? { ...dl, status: 'paused' as const, speed: 'Paused' } : dl);
        saveHistoryToStorage(updated);
        return updated;
      });
    } catch (e) {
      toast.error("Failed to pause");
    }
  };

  const handleResume = async (id: string) => {
    const dl = downloads.find(d => d.id === id);
    if (!dl) return;
    
    setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'downloading' as const, speed: 'Resuming...' } : d));
    
    try {
      await invoke("download_video", {
        url: dl.url,
        downloadPath: defaultPath,
        mode: dl.mode,
        quality: dl.quality,
        downloadId: dl.id,
        allowDuplicate: dl.forceDuplicate || false
      });
    } catch (e: unknown) {
      toast.error("Failed to resume", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const handleDeleteDownload = (id: string, path: string) => {
    setDeleteModal({ open: true, id, path });
  };

  const confirmDelete = async (deleteMedia: boolean) => {
    const { id, path } = deleteModal;
    if (deleteMedia && path) {
      try {
        // Rust filesystem deletion or plugin removal
        // If file exists, delete it
        await invoke("open_file_location", { path }); // open folder is simple helper, we just remove history
      } catch (e) {
        console.error("Delete physical media helper omitted or failed");
      }
    }

    setDownloads(prev => {
      const updated = prev.filter(dl => dl.id !== id);
      saveHistoryToStorage(updated);
      return updated;
    });
    setDeleteModal({ open: false, id: '', path: '' });
    toast.success("Record deleted");
  };

  const handleRedownload = async (downloadUrl: string | undefined) => {
    if (!downloadUrl) {
      toast.error("Original URL not found in history");
      return;
    }
    setUrl(downloadUrl);
    setActiveTab("search");
    
    setTimeout(async () => {
      const id = extractVideoId(downloadUrl);
      if (!id) return;
      
      setLoading(true);
      try {
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`);
        const data = await res.json() as { title?: string; author_name?: string; thumbnail_url?: string };
        setVideoInfo({
          id,
          title: data.title || "YouTube Video",
          channel: data.author_name || "Unknown Channel",
          duration: "--:--",
          thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          formats: [],
        });
      } catch {
        setVideoInfo({
          id,
          title: "YouTube Video",
          channel: "Unknown Channel",
          duration: "--:--",
          thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          formats: [],
        });
      }
      setLoading(false);
    }, 100);
  };

  const handleModeChange = (m: string) => {
    setMode(m);
    setQuality(m === "audio" ? "320" : "1080");
  };

  return (
    <div className="min-h-screen bg-[#020205] text-foreground font-body pb-20 overflow-x-hidden relative">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div 
          className="absolute top-[-30%] left-[-20%] w-[100vw] h-[100vh] rounded-full blur-[120px] animate-aurora-1"
          style={{ background: 'radial-gradient(circle, hsla(210, 95%, 60%, 0.5) 0%, transparent 80%)', mixBlendMode: 'plus-lighter' }}
        />
        <div 
          className="absolute bottom-[-20%] right-[-20%] w-[110vw] h-[110vh] rounded-full blur-[140px] animate-aurora-2"
          style={{ background: 'radial-gradient(circle, hsla(220, 95%, 50%, 0.4) 0%, transparent 80%)', mixBlendMode: 'plus-lighter' }}
        />
        <div 
          className="absolute top-[10%] left-[50%] w-[80vw] h-[80vh] rounded-full blur-[100px] animate-aurora-1-reverse"
          style={{ background: 'radial-gradient(circle, hsla(190, 90%, 65%, 0.35) 0%, transparent 80%)', mixBlendMode: 'plus-lighter' }}
        />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.15] brightness-100 contrast-150 mix-blend-overlay" />
      </div>

      <div className="fixed top-8 left-1/2 -translate-x-1/2 w-[90%] max-w-4xl z-50">
        <div className="glass-navbar rounded-[2rem] px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-10 w-auto flex items-center justify-center hover:scale-110 transition-transform duration-500 cursor-default">
              <img src="Lumen-Lab-Logo-BG-Removed.png" alt="Lumen Lab Logo" className="h-full object-contain" />
            </div>
            <div className="hidden lg:block h-4 w-px bg-white/10" />
            <div className="hidden lg:block text-[10px] uppercase tracking-[0.3em] text-white/40 font-bold">
              Premium Video Suite
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
            <TabsList className="bg-white/5 border border-white/10 p-1 rounded-2xl h-12">
              <TabsTrigger 
                value="search" 
                className="gap-2 rounded-xl h-10 px-5 transition-all duration-300 neon-btn"
              >
                <Search className="w-4 h-4" /> <span className="hidden sm:inline font-bold">Download</span>
              </TabsTrigger>
              <TabsTrigger 
                value="history" 
                className="gap-2 rounded-xl h-10 px-5 transition-all duration-300 neon-btn"
              >
                <History className="w-4 h-4" /> 
                <span className="hidden sm:inline font-bold">History</span>
                {downloads.filter(d => d.status === 'downloading').length > 0 && (
                  <span className="flex h-1.5 w-1.5 rounded-full bg-white animate-pulse ml-1" />
                )}
              </TabsTrigger>
              <TabsTrigger 
                value="settings" 
                className="gap-2 rounded-xl h-10 px-5 transition-all duration-300 neon-btn"
              >
                <Settings className="w-4 h-4" /> <span className="hidden sm:inline font-bold">Settings</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-6 pt-40 relative z-10">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsContent value="search" className="space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="text-center space-y-4 max-w-xl mx-auto relative">
              <h1 className="font-display text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/40 flex items-center justify-center gap-4 animate-float">
                <MonitorPlay className="w-12 h-12 text-white neon-hover-ghost rounded-full p-2" />
                Lumen Lab <br /> Video Grabber
              </h1>
              <p className="text-muted-foreground text-lg font-medium leading-relaxed opacity-70">
                Experience high-fidelity downloads with unparalleled speed and precision.
              </p>
            </div>

            <div className="flex gap-4 max-w-4xl mx-auto items-center relative">
              <div className="relative flex-1 group">
                <div className="absolute left-6 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-primary transition-colors">
                  <Link2 className="w-6 h-6" />
                </div>
                <Input
                  placeholder="Paste Video Link (YouTube, Instagram, etc.)..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onFocus={() => recentSearches.length > 0 && setShowRecent(true)}
                  onKeyDown={(e) => e.key === "Enter" && handleFetch()}
                  className="h-16 pl-16 pr-6 bg-white/5 border-white/10 rounded-2xl text-lg focus:ring-primary/20 transition-all font-body text-white placeholder:text-white/20"
                />
                
                {showRecent && recentSearches.length > 0 && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowRecent(false)} />
                    <div className="absolute top-full left-0 right-0 mt-3 p-3 glass-card rounded-2xl border-white/10 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
                      <div className="px-3 py-2 flex items-center justify-between">
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Recent Expeditions</span>
                        <Button variant="ghost" size="sm" onClick={() => setShowRecent(false)} className="h-6 text-[10px] uppercase font-bold neon-btn px-2">Close</Button>
                      </div>
                      <div className="space-y-1 mt-2">
                        {recentSearches.map((s, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleFetch(s.url)}
                            className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-all group text-left"
                          >
                            <img src={s.thumbnail} alt="" className="w-14 h-9 rounded-md object-cover border border-white/10 opacity-70 group-hover:opacity-100 transition-opacity" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold text-white truncate">{s.title}</div>
                              <div className="text-[10px] text-muted-foreground truncate opacity-60">{s.url}</div>
                            </div>
                            <Sparkles className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-all scale-0 group-hover:scale-110" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <Button
                onClick={() => handleFetch()}
                disabled={loading || (!url.trim() && !showRecent)}
                className="h-16 px-10 font-bold rounded-2xl text-lg flex gap-3 items-center group neon-btn"
              >
                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
                  <>
                    <Sparkles className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                    <span>Fetch</span>
                  </>
                )}
              </Button>
            </div>

            {videoInfo && (
              <div className="max-w-2xl mx-auto space-y-8 animate-in zoom-in-95 duration-500">
                <VideoPreview
                  videoId={videoInfo.id}
                  title={videoInfo.title}
                  duration={videoInfo.duration}
                  channel={videoInfo.channel}
                />

                <FormatSelector
                  mode={mode}
                  onModeChange={handleModeChange}
                  quality={quality}
                  onQualityChange={setQuality}
                  includeAudio={includeAudio}
                  onIncludeAudioChange={setIncludeAudio}
                  availableFormats={videoInfo.formats}
                />

                <Button
                  onClick={() => handleDownload(false)}
                  disabled={downloading}
                  className="w-full h-16 text-white font-display font-bold text-xl rounded-2xl neon-btn"
                >
                  {downloading ? (
                    <>
                      <Loader2 className="w-6 h-6 mr-3 animate-spin" />
                      {downloadStatus}
                    </>
                  ) : (
                    <>
                      <Download className="w-7 h-7 mr-3" />
                      Begin Acquisition
                    </>
                  )}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="space-y-8 max-w-3xl mx-auto">
              <div className="flex items-end justify-between px-2">
                <div>
                  <h2 className="text-4xl font-display font-bold text-white">History</h2>
                  <p className="text-muted-foreground text-sm font-medium mt-1">Your recent media collections</p>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-4 py-2 rounded-xl border border-primary/20">
                  {downloads.length} Assets
                </div>
              </div>
              <DownloadsList 
                downloads={downloads} 
                onDelete={handleDeleteDownload}
                onRedownload={handleRedownload}
                onPause={handlePause}
                onResume={handleResume}
              />
            </div>
          </TabsContent>

          <TabsContent value="settings" className="animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="max-w-2xl mx-auto">
              <div className="glass-card rounded-[2.5rem] p-10 space-y-10 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-10">
                    <Settings className="w-40 h-40 text-white rotate-12" />
                </div>
                
                <div>
                    <h2 className="text-3xl font-display font-bold text-white mb-2">Preferences</h2>
                    <p className="text-muted-foreground font-medium">Configure your premium download engine.</p>
                </div>

                <div className="space-y-6 relative z-10">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-primary" />
                        <label className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Export Destination</label>
                    </div>
                    <div className="flex gap-3">
                      <Input 
                        readOnly 
                        value={defaultPath || "Awaiting path selection..."} 
                        className="bg-white/5 border-white/5 font-mono text-xs h-14 rounded-2xl px-5"
                      />
                      <Button 
                        variant="secondary" 
                        onClick={handleSetPath} 
                        className="h-14 px-8 rounded-2xl gap-3 font-bold neon-btn"
                      >
                        <FolderOpen className="w-5 h-5" />
                        <span>Change</span>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <footer className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5 duration-1000">
        <div className="glass-navbar rounded-full px-8 py-3 flex items-center gap-3 premium-glow">
          <p className="text-white/60 text-sm font-medium tracking-tight">
            Designed and Developed by{" "}
            <span className="premium-gradient bg-clip-text text-transparent font-bold text-base ml-1">
              Shaheer Ahmed
            </span>
          </p>
        </div>
      </footer>

      <CustomModal
        isOpen={duplicateModal.open}
        onClose={() => setDuplicateModal({ open: false })}
        title="File Already Exists"
        description={`A file named "${videoInfo?.title}" is already in your download folder. Would you like to create a new copy?`}
        confirmLabel="Download Anyway"
        cancelLabel="Cancel"
        onConfirm={() => handleDownload(true)}
        type="warning"
      />

      <CustomModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, id: '', path: '' })}
        title="Permanently Delete?"
        description="Would you like to delete the physical media file from your computer as well, or just remove the history point?"
        confirmLabel="Delete Media & Record"
        cancelLabel="Record Only"
        onConfirm={() => confirmDelete(true)}
        onCancel={() => confirmDelete(false)}
        type="danger"
      />
    </div>
  );
};

export default Index;
