use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Serialize, Deserialize};
use tauri::{AppHandle, Emitter, Manager};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::fs::{File, create_dir_all};
use std::io::{Write, Read};

lazy_static::lazy_static! {
    static ref ABORT_FLAGS: Arc<Mutex<HashMap<String, bool>>> = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FormatItem {
    pub height: u32,
    pub filesize: Option<u64>,
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VideoInfo {
    pub id: Option<String>,
    pub title: Option<String>,
    pub channel: Option<String>,
    pub duration: Option<serde_json::Value>,
    pub thumbnail: Option<String>,
    pub formats: Vec<FormatItem>,
}

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub download_id: String,
    pub percent: f64,
    pub speed: String,
    pub eta: i64,
    pub filepath: Option<String>,
    pub total_size: Option<String>,
}

// Get the local app data path for dependencies
fn get_bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    path.push("bin");
    if !path.exists() {
        create_dir_all(&path).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

// Get correct executable file name/path
fn get_exe_path(app: &AppHandle, name: &str) -> PathBuf {
    let mut dir = get_bin_dir(app).unwrap_or_else(|_| PathBuf::from("."));
    #[cfg(target_os = "windows")]
    let filename = format!("{}.exe", name);
    #[cfg(not(target_os = "windows"))]
    let filename = name.to_string();
    
    dir.push(filename);
    dir
}

// Check if command is available globally or locally
fn find_command_path(app: &AppHandle, name: &str) -> Option<PathBuf> {
    // Check locally first
    let local_path = get_exe_path(app, name);
    if local_path.exists() {
        return Some(local_path);
    }
    
    // Check globally
    let check_cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    if let Ok(output) = Command::new(check_cmd).arg(name).output() {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                return Some(PathBuf::from(path_str));
            }
        }
    }
    None
}

#[tauri::command]
pub fn check_dependencies(app: AppHandle) -> HashMap<String, bool> {
    let mut status = HashMap::new();
    status.insert("ffmpeg".to_string(), find_command_path(&app, "ffmpeg").is_some());
    status.insert("ytdlp".to_string(), find_command_path(&app, "yt-dlp").is_some());
    status
}

#[tauri::command]
pub async fn download_dependencies(app: AppHandle) -> Result<(), String> {
    let bin_dir = get_bin_dir(&app)?;
    
    // Download yt-dlp
    if find_command_path(&app, "yt-dlp").is_none() {
        let yt_url = if cfg!(target_os = "windows") {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
        } else if cfg!(target_os = "macos") {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
        } else {
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
        };
        
        let target_path = get_exe_path(&app, "yt-dlp");
        let response = reqwest::get(yt_url).await.map_err(|e| e.to_string())?;
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        
        let mut file = File::create(&target_path).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        
        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&target_path, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
    }

    // Download FFmpeg
    if find_command_path(&app, "ffmpeg").is_none() {
        let ffmpeg_url = if cfg!(target_os = "windows") {
            "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip"
        } else if cfg!(target_os = "macos") {
            "https://evermeet.cx/ffmpeg/getrelease/zip"
        } else {
            "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
        };
        
        let response = reqwest::get(ffmpeg_url).await.map_err(|e| e.to_string())?;
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        
        // Write archive temporarily
        let archive_path = bin_dir.join("ffmpeg_archive");
        let mut file = File::create(&archive_path).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        
        if ffmpeg_url.ends_with(".zip") || cfg!(target_os = "macos") {
            // Extract zip
            let zip_file = File::open(&archive_path).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(zip_file).map_err(|e| e.to_string())?;
            for i in 0..archive.len() {
                let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
                let file_name = file.name().to_string();
                if file_name.ends_with("ffmpeg") || file_name.ends_with("ffmpeg.exe") {
                    let target_path = get_exe_path(&app, "ffmpeg");
                    let mut out_file = File::create(&target_path).map_err(|e| e.to_string())?;
                    let mut buffer = Vec::new();
                    file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
                    out_file.write_all(&buffer).map_err(|e| e.to_string())?;
                    
                    #[cfg(not(target_os = "windows"))]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        std::fs::set_permissions(&target_path, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
                    }
                    break;
                }
            }
        } else {
            // Extract tar.xz (Linux)
            let tar_xz_file = File::open(&archive_path).map_err(|e| e.to_string())?;
            let decompressed = flate2::read::GzDecoder::new(tar_xz_file);
            let mut archive = tar::Archive::new(decompressed);
            if let Ok(entries) = archive.entries() {
                for entry in entries.flatten() {
                    if let Ok(path) = entry.path() {
                        let path_str = path.to_string_lossy();
                        if path_str.ends_with("ffmpeg") {
                            let target_path = get_exe_path(&app, "ffmpeg");
                            let mut out_file = File::create(&target_path).map_err(|e| e.to_string())?;
                            let mut buffer = Vec::new();
                            let mut entry_mut = entry;
                            entry_mut.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
                            out_file.write_all(&buffer).map_err(|e| e.to_string())?;
                            
                            use std::os::unix::fs::PermissionsExt;
                            std::fs::set_permissions(&target_path, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
                            break;
                        }
                    }
                }
            }
        }
        
        let _ = std::fs::remove_file(archive_path);
    }
    
    Ok(())
}

#[tauri::command]
pub async fn fetch_video_info(app: AppHandle, url: String) -> Result<VideoInfo, String> {
    let ytdlp_bin = find_command_path(&app, "yt-dlp")
        .ok_or_else(|| "yt-dlp executable not found".to_string())?;

    let output = Command::new(ytdlp_bin)
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

    // Extract available video heights and map to FormatItem
    let mut formats = Vec::new();
    if let Some(formats_arr) = json_val.get("formats").and_then(|f| f.as_array()) {
        for f in formats_arr {
            if let Some(height) = f.get("height").and_then(|h| h.as_u64()) {
                let height_u32 = height as u32;
                if height_u32 > 0 && !formats.iter().any(|item: &FormatItem| item.height == height_u32) {
                    let filesize = f.get("filesize")
                        .or_else(|| f.get("filesize_approx"))
                        .and_then(|v| v.as_u64());

                    let size_label = match filesize {
                        Some(size) => {
                            let mb = size as f64 / (1024.0 * 1024.0);
                            format!(" ({:.1} MB)", mb)
                        }
                        None => "".to_string(),
                    };

                    let mut label = format!("{}p{}", height_u32, size_label);
                    if height_u32 == 2160 { label = format!("4K (2160p){}", size_label); }
                    if height_u32 == 1440 { label = format!("2K (1440p){}", size_label); }
                    if height_u32 == 1080 { label = format!("1080p (Full HD){}", size_label); }
                    if height_u32 == 720 { label = format!("720p (HD){}", size_label); }

                    formats.push(FormatItem {
                        height: height_u32,
                        filesize,
                        label,
                    });
                }
            }
        }
    }
    formats.sort_by(|a, b| b.height.cmp(&a.height)); // Sort descending by resolution height

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
    
    #[cfg(target_os = "windows")]
    {
        if p.exists() && !p.is_dir() {
            Command::new("explorer")
                .arg("/select,")
                .arg(p.to_string_lossy().to_string())
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            let folder = p.parent().unwrap_or(Path::new("."));
            Command::new("explorer")
                .arg(folder.to_string_lossy().to_string())
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        if p.exists() && !p.is_dir() {
            Command::new("open")
                .arg("-R")
                .arg(p.to_string_lossy().to_string())
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            let folder = p.parent().unwrap_or(Path::new("."));
            Command::new("open")
                .arg(folder.to_string_lossy().to_string())
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        if p.exists() && !p.is_dir() {
            // Try dbus-send first to select file across desktop managers, fallback to folder open if it fails
            let dbus_result = Command::new("dbus-send")
                .args([
                    "--session",
                    "--print-reply",
                    "--dest=org.freedesktop.FileManager1",
                    "/org/freedesktop/FileManager1",
                    "org.freedesktop.FileManager1.ShowItems",
                    &format!("array:string:file://{}", p.canonicalize().unwrap_or_else(|_| p.to_path_buf()).to_string_lossy()),
                    "string:\"\""
                ])
                .output();

            if dbus_result.is_err() || !dbus_result.unwrap().status.success() {
                // Fallback to file manager specific highlight flags
                let folder = p.parent().unwrap_or(Path::new("."));
                
                // Attempt to run nautilus select (most common in debian/ubuntu)
                let nautilus = Command::new("nautilus")
                    .arg("-s")
                    .arg(p.to_string_lossy().to_string())
                    .spawn();

                if nautilus.is_err() {
                    // Fall back to general folder open
                    Command::new("xdg-open")
                        .arg(folder.to_string_lossy().to_string())
                        .spawn()
                        .map_err(|e| e.to_string())?;
                }
            }
        } else {
            let folder = p.parent().unwrap_or(Path::new("."));
            Command::new("xdg-open")
                .arg(folder.to_string_lossy().to_string())
                .spawn()
                .map_err(|e| e.to_string())?;
        }
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

    let ytdlp_bin = find_command_path(&app, "yt-dlp")
        .ok_or_else(|| "yt-dlp executable not found".to_string())?;
        
    let ffmpeg_bin = find_command_path(&app, "ffmpeg");

    // We'll spawn yt-dlp in a background thread and parse its output.
    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(ytdlp_bin);
        
        // Add ffmpeg location to yt-dlp path if we have it locally
        if let Some(ref ffmpeg_path) = ffmpeg_bin {
            if let Some(parent) = ffmpeg_path.parent() {
                // Prepend or add custom path
                cmd.args(["--ffmpeg-location", &parent.to_string_lossy()]);
            }
        }

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

        // Track the filename printed by yt-dlp to emit the exact file path
        let mut final_filepath = None;

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
                        total_size: None,
                    });
                    return;
                }
            }

            // Detect destination file path outputted by yt-dlp
            // Example: [download] Destination: /path/to/downloads/VideoTitle.mp4
            // Or: [Merger] Merging formats into "/path/to/downloads/VideoTitle.mp4"
            if line.contains("[download] Destination:") {
                if let Some(dest) = line.split("Destination: ").nth(1) {
                    final_filepath = Some(dest.trim().to_string());
                }
            } else if line.contains("[Merger] Merging formats into") {
                if let Some(dest) = line.split("into \"").nth(1) {
                    let path_clean = dest.replace("\"", "");
                    final_filepath = Some(path_clean.trim().to_string());
                }
            } else if line.contains("[ExtractAudio] Destination:") {
                if let Some(dest) = line.split("Destination: ").nth(1) {
                    final_filepath = Some(dest.trim().to_string());
                }
            }

            // Parsing logic for yt-dlp progress output
            // Example: [download]  10.0% of 50.00MiB at 4.23MiB/s ETA 00:10
            if line.contains("[download]") && line.contains("%") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                let mut percent = 0.0;
                let mut speed = "0 MB/s".to_string();
                let mut eta = 0;

                let mut total_size = None;

                for (i, part) in parts.iter().enumerate() {
                    if part.contains("%") {
                        if let Ok(val) = part.replace("%", "").parse::<f64>() {
                            percent = val;
                        }
                    }
                    if *part == "of" && i + 1 < parts.len() {
                        total_size = Some(parts[i+1].to_string());
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
                    filepath: final_filepath.clone(),
                    total_size,
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
                filepath: final_filepath,
                total_size: None,
            });
        } else {
            let _ = app_clone.emit("download-error", (download_id_clone, "Download failed or interrupted".to_string()));
        }
    });

    Ok(download_id)
}
