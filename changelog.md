# Changelog

All notable changes to the **Lumen Video Grabber** project are documented in this file.

## [2.0.5] - 2026-07-18

### Added
- **Tauri v2 Shell Backend:** Initialized Tauri v2 Rust project setup, replacing the legacy Python/PyWebView wrapper backend architecture completely.
- **Dynamic Format Sizing:** Displays estimate filesizes beside each quality selection inside the format list.
- **Completed Size Statistics:** Emits active progress metrics mapping the downloaded size compared to total file size (e.g. `12.50MB / 50.00MiB`).
- **File Manager Highlight:** Opening folders now targets and highlights the completed video/audio file inside directories on Windows (`explorer /select`), Linux (`dbus-send` / `nautilus`), and macOS (`open -R`).

### Changed
- **Lagless 4K Video Merging:** Forced merged streams to output using target MP4 container rules to eliminate lags during high-fidelity 4K playback.
- **Resuming Logic:** Saved specific mode and quality configurations to local history objects so that interrupted resume cycles do not start over at 0% or target incorrect quality streams.
- **Auto-Pause on Mount:** Handled app restarts or crash sequences by auto-saving ongoing downloads to a `paused` state instead of marking them as `failed`.

### Removed
- **Legacy Python files:** Deleted deprecated `app.py`, `downloader.py`, `requirements.txt`, PyInstaller spec layouts, and Python virtual environment folders.
- **Security:** Right-click context menus are blocked to prevent inspector debugging popups inside compiled production builds.
