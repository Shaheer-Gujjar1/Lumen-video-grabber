import { Video, Music, Volume2, VolumeX, Monitor, Headphones } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

interface FormatSelectorProps {
  mode: string;
  onModeChange: (mode: string) => void;
  quality: string;
  onQualityChange: (q: string) => void;
  includeAudio: boolean;
  onIncludeAudioChange: (v: boolean) => void;
  availableHeights?: number[];
}

const defaultVideoQualities = [
  { value: "2160", label: "4K", desc: "2160p • Best quality" },
  { value: "1080", label: "1080p", desc: "Full HD" },
  { value: "720", label: "720p", desc: "HD" },
  { value: "480", label: "480p", desc: "Standard" },
  { value: "360", label: "360p", desc: "Low" },
];

const audioQualities = [
  { value: "320", label: "320 kbps", desc: "Best quality" },
  { value: "256", label: "256 kbps", desc: "High quality" },
  { value: "192", label: "192 kbps", desc: "Good quality" },
  { value: "128", label: "128 kbps", desc: "Standard" },
  { value: "64", label: "64 kbps", desc: "Low" },
];

const FormatSelector = ({
  mode,
  onModeChange,
  quality,
  onQualityChange,
  includeAudio,
  onIncludeAudioChange,
  availableHeights,
}: FormatSelectorProps) => {
  const videoQualities = availableHeights && availableHeights.length > 0
    ? availableHeights.map(h => {
        let label = `${h}p`;
        if (h === 2160) label = "4K (2160p)";
        if (h === 1440) label = "2K (1440p)";
        if (h === 1080) label = "1080p (Full HD)";
        if (h === 720) label = "720p (HD)";
        return { value: h.toString(), label, desc: `Acquire in ${h}p` };
      })
    : defaultVideoQualities;

  const qualities = mode === "audio" ? audioQualities : videoQualities;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
      <Tabs value={mode} onValueChange={onModeChange} className="w-full">
        <TabsList className="w-full bg-black/20 border border-white/5 h-14 p-1 rounded-2xl">
          <TabsTrigger
            value="video"
            className="flex-1 font-display rounded-xl h-10 gap-2 transition-all duration-300 neon-btn"
          >
            <Video className="w-4 h-4" /> Video
          </TabsTrigger>
          <TabsTrigger
            value="audio"
            className="flex-1 font-display rounded-xl h-10 gap-2 transition-all duration-300 neon-btn"
          >
            <Music className="w-4 h-4" /> MP3 Only
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "video" && (
        <button
          onClick={() => onIncludeAudioChange(!includeAudio)}
          className={`flex items-center gap-4 w-full p-4 rounded-2xl transition-all duration-300 group border ${
            includeAudio ? "neon-btn" : "neon-card group-hover:bg-white/5"
          }`}
        >
          <div className={`p-3 rounded-xl transition-all duration-300 ${includeAudio ? "bg-primary text-white premium-glow scale-110" : "bg-white/5 text-muted-foreground"}`}>
            {includeAudio ? (
              <Volume2 className="w-5 h-5" />
            ) : (
              <VolumeX className="w-5 h-5" />
            )}
          </div>
          <div className="text-left">
            <div className="text-base font-bold text-white font-display">Audio Integration</div>
            <div className="text-[11px] text-muted-foreground font-medium">
              {includeAudio ? "Including high-fidelity stereo track" : "Silent video track acquisition"}
            </div>
          </div>
          <div
            className={`ml-auto w-14 h-7 rounded-full transition-all duration-500 flex items-center px-1.5 border border-white/20 ${
              includeAudio ? "premium-gradient shadow-inner" : "bg-white/10"
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full bg-white shadow-xl transition-transform duration-500 ease-out ${
                includeAudio ? "translate-x-7 scale-110" : "translate-x-0"
              }`}
            />
          </div>
        </button>
      )}

      <div className="space-y-4">
        <div className="flex items-center gap-2 px-1">
          <div className="w-1 h-3 rounded-full bg-primary" />
          <h4 className="font-display text-sm font-bold text-white uppercase tracking-widest">
            {mode === "audio" ? "Audio Resolution" : "Video Resolution"}
          </h4>
        </div>
        <RadioGroup value={quality} onValueChange={onQualityChange} className="grid grid-cols-1 gap-3">
          {qualities.map((q) => (
            <Label
              key={q.value}
              htmlFor={q.value}
              className={`flex items-center gap-4 p-5 rounded-2xl cursor-pointer transition-all duration-500 border group active:scale-[0.98] ${
                quality === q.value
                  ? "border-primary/50 bg-primary/10 premium-glow shadow-[0_0_30px_-10px_hsla(0,85%,55%,0.3)]"
                  : "border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/10 hover:scale-[1.01]"
              }`}
            >
              <RadioGroupItem 
                value={q.value} 
                id={q.value} 
                className="w-5 h-5 border-white/20 data-[state=checked]:border-primary data-[state=checked]:text-primary" 
              />
              <div className="flex flex-col">
                <span className={`font-display font-bold text-base flex items-center gap-2 transition-colors ${quality === q.value ? "text-white" : "text-white/70"}`}>
                  {mode === "audio" ? <Headphones className="w-4 h-4 text-primary" /> : <Monitor className="w-4 h-4 text-primary" />}
                  {q.label}
                </span>
                <span className="text-muted-foreground text-[11px] uppercase tracking-wider font-semibold ml-6 opacity-60 group-hover:opacity-100 transition-opacity">{q.desc}</span>
              </div>
              <div className="ml-auto">
                <div className={`text-[11px] font-bold px-3 py-1 rounded-full border transition-all ${
                    quality === q.value ? "bg-primary text-white border-primary premium-glow" : "bg-white/5 border-white/10 text-white/40"
                }`}>
                  {q.value === "2160" ? "ULTRA" : q.value === "1080" ? "FULL" : "SD"}
                </div>
              </div>
            </Label>
          ))}
        </RadioGroup>
      </div>
    </div>
  );
};

export default FormatSelector;
