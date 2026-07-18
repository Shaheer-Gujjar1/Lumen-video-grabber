use std::path::Path;
use std::process::Command;
use serde::{Serialize, Deserialize};
use tauri::{AppHandle, Emitter};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

lazy_static::lazy_static! {
    static ref ABORT_FLAGS: Arc<Mutex<HashMap<String, bool>>> = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VideoInfo {
    pub id: Option<String>,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub duration: Option<serde_json::Value>,
    pub thumbnail: Option<String>,
    pub formats: Vec<u32>,
}

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub download_id: String,
    pub percent: f64,
    pub speed: String,
    pub eta: i64,
    pub filepath: Option<String>,
}

#[tauri::command]
pub fn check_dependencies() -> HashMap<String, bool> {
    let mut status = HashMap::new();
    
    // Check FFmpeg
    let ffmpeg_ok = Command::new("ffmpeg")
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
        
    // Check yt-dlp
    let ytdlp_ok = Command::new("yt-dlp")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    status.insert("ffmpeg".to_string(), ffmpeg_ok);
    status.insert("ytdlp".to_string(), ytdlp_ok);
    status
}

#[tauri::command]
pub async fn fetch_video_info(url: String) -> Result<VideoInfo, String> {
    let output = Command::new("yt-dlp")
        .args(["--dump-json", "--no-playlist", "--quiet", &url])
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let err_str = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp error: {}", err_str));
    }

    let json_val: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let id = json_val.get("id").and_then(|v| v.as_str()).map(String::from);
    let title = json_val.get("title").and_then(|v| v.as_str()).map(String::from);
    let channel = json_val.get("uploader").and_then(|v| v.as_str()).map(String::from);
    
    let duration = json_val.get("duration_string")
        .or_else(|| json_val.get("duration"))
        .cloned();

    let thumbnail = json_val.get("thumbnail").and_then(|v| v.as_str()).map(String::from);

    // Extract available video heights
    let mut formats = Vec::new();
    if let Some(formats_arr) = json_val.get("formats").and_then(|f| f.as_array()) {
        for f in formats_arr {
            if let Some(height) = f.get("height").and_then(|h| h.as_u64()) {
                let height_u32 = height as u32;
                if height_u32 > 0 && !formats.contains(&height_u32) {
                    formats.push(height_u32);
                }
            }
        }
    }
    formats.sort_by(|a, b| b.cmp(a)); // Sort descending (e.g. 2160, 1080, 720...)

    Ok(VideoInfo {
        id,
        title,
        channel,
        duration,
        thumbnail,
        formats,
    })
}

#[tauri::command]
pub fn pause_download(download_id: String) -> Result<(), String> {
    if let Ok(mut flags) = ABORT_FLAGS.lock() {
        flags.insert(download_id, true);
    }
    Ok(())
}

#[tauri::command]
pub fn open_file_location(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let folder = if p.is_dir() { p } else { p.parent().unwrap_or(Path::new(".")) };
    
    #[cfg(target_os = "windows")]
    {
        if p.exists() && !p.is_dir() {
            Command::new("explorer")
                .arg("/select,")
                .arg(p.to_string_lossy().to_string())
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            Command::new("explorer")
                .arg(folder.to_string_lossy().to_string())
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(folder.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn check_file_exists(folder: String, filename: String) -> Result<serde_json::Value, String> {
    let dir = Path::new(&folder);
    if !dir.exists() {
        return Ok(serde_json::json!({ "exists": false }));
    }

    // Clean name slightly (similar to yt-dlp replacement of special characters)
    let cleaned = filename.replace(|c: char| !c.is_alphanumeric() && c != '.' && c != '-' && c != '_', "");
    
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let name_lower = name.to_lowercase();
            let check_name_lower = filename.to_lowercase();
            let cleaned_lower = cleaned.to_lowercase();
            
            if name_lower.contains(&check_name_lower) || check_name_lower.contains(&name_lower) || name_lower.contains(&cleaned_lower) {
                return Ok(serde_json::json!({
                    "exists": true,
                    "path": entry.path().to_string_lossy().to_string()
                }));
            }
        }
    }

    Ok(serde_json::json!({ "exists": false }))
}

#[tauri::command]
pub async fn download_video(
    app: AppHandle,
    url: String,
    download_path: String,
    mode: String,
    quality: String,
    download_id: String,
    allow_duplicate: bool,
) -> Result<String, String> {
    let app_clone = app.clone();
    let download_id_clone = download_id.clone();
    
    // Clear abort flag if any
    if let Ok(mut flags) = ABORT_FLAGS.lock() {
        flags.insert(download_id_clone.clone(), false);
    }

    // Prepare format argument
    let format_arg = if mode == "audio" {
        "bestaudio/best".to_string()
    } else {
        format!("bestvideo[height<={}]+bestaudio/best[height<={}]", quality, quality)
    };

    // Output template
    let output_template = if allow_duplicate {
        format!("{}/%(title)s-%(id)s.%(ext)s", download_path)
    } else {
        format!("{}/%(title)s.%(ext)s", download_path)
    };

    // We'll spawn yt-dlp in a background thread and parse its output.
    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new("yt-dlp");
        cmd.args([
            "--newline",
            "--progress",
            "-f", &format_arg,
            "-o", &output_template,
        ]);

        if mode == "audio" {
            let audio_quality = if ["320", "256", "192", "128", "64"].contains(&quality.as_str()) {
                &quality
            } else {
                "192"
            };
            cmd.args([
                "--extract-audio",
                "--audio-format", "mp3",
                "--audio-quality", audio_quality,
            ]);
        } else {
            cmd.args(["--merge-output-format", "mp4"]);
        }

        cmd.arg(&url);

        // Run the command and capture output line by line
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app_clone.emit("download-error", (download_id_clone, e.to_string()));
                return;
            }
        };

        let stdout = child.stdout.take().unwrap();
        let reader = std::io::BufReader::new(stdout);
        use std::io::BufRead;

        for line in reader.lines().map_while(Result::ok) {
            // Check abort flag
            if let Ok(flags) = ABORT_FLAGS.lock() {
                if *flags.get(&download_id_clone).unwrap_or(&false) {
                    let _ = child.kill();
                    let _ = app_clone.emit("download-status", ProgressPayload {
                        download_id: download_id_clone.clone(),
                        percent: 0.0,
                        speed: "Paused".to_string(),
                        eta: 0,
                        filepath: None,
                    });
                    return;
                }
            }

            // Parsing logic for yt-dlp progress output
            // Example: [download]  10.0% of 50.00MiB at 4.23MiB/s ETA 00:10
            if line.contains("[download]") && line.contains("%") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                let mut percent = 0.0;
                let mut speed = "0 MB/s".to_string();
                let mut eta = 0;

                for (i, part) in parts.iter().enumerate() {
                    if part.contains("%") {
                        if let Ok(val) = part.replace("%", "").parse::<f64>() {
                            percent = val;
                        }
                    }
                    if *part == "at" && i + 1 < parts.len() {
                        speed = parts[i+1].to_string();
                    }
                    if *part == "ETA" && i + 1 < parts.len() {
                        let eta_str = parts[i+1];
                        let eta_parts: Vec<&str> = eta_str.split(':').collect();
                        if eta_parts.len() == 2 {
                            let m = eta_parts[0].parse::<i64>().unwrap_or(0);
                            let s = eta_parts[1].parse::<i64>().unwrap_or(0);
                            eta = m * 60 + s;
                        } else if eta_parts.len() == 3 {
                            let h = eta_parts[0].parse::<i64>().unwrap_or(0);
                            let m = eta_parts[1].parse::<i64>().unwrap_or(0);
                            let s = eta_parts[2].parse::<i64>().unwrap_or(0);
                            eta = h * 3600 + m * 60 + s;
                        }
                    }
                }

                let _ = app_clone.emit("download-progress", ProgressPayload {
                    download_id: download_id_clone.clone(),
                    percent,
                    speed,
                    eta,
                    filepath: None,
                });
            }
        }

        let status = child.wait().unwrap();
        if status.success() {
            let _ = app_clone.emit("download-progress", ProgressPayload {
                download_id: download_id_clone,
                percent: 100.0,
                speed: "0 MB/s".to_string(),
                eta: 0,
                filepath: Some(format!("{}/completed_file", download_path)),
            });
        } else {
            let _ = app_clone.emit("download-error", (download_id_clone, "Download failed or interrupted".to_string()));
        }
    });

    Ok(download_id)
}
