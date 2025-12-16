// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

// src-tauri/src/lib.rs
mod thumb_protocol;
mod utils;

use crate::thumb_protocol::ThumbnailCacheState;
use crate::utils::{get_hash_filename, get_temp_dir};
use base64::{engine::general_purpose, Engine as _};
use std::fs;
use std::path::Path;
use std::time::Instant;
use tauri::{AppHandle, Manager};

// =========================================================
// 2. Tauri Commands (供前端调用)
// =========================================================

#[tauri::command]
async fn save_temp_image(app: AppHandle, base64_data: String) -> Result<String, String> {
    let start_time = Instant::now();
    // 1. 解码 Base64
    // 前端传来的可能是 "data:image/png;base64,..."，需要去掉头部
    let split: Vec<&str> = base64_data.split(",").collect();
    let raw_base64 = if split.len() > 1 { split[1] } else { split[0] };

    let image_data = general_purpose::STANDARD
        .decode(raw_base64)
        .map_err(|e| e.to_string())?;

    // 2. 计算 Hash (实现自动去重)
    let filename = get_hash_filename(&image_data, "png"); // 假设统一转为 png 或根据头判断

    // 3. 写入临时目录
    let temp_dir = get_temp_dir(&app);
    if !temp_dir.exists() {
        fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    }

    let file_path = temp_dir.join(&filename);

    // 如果文件不存在才写入 (去重)
    if !file_path.exists() {
        fs::write(&file_path, &image_data).map_err(|e| e.to_string())?;
    }
    println!("save_temp_image：{:?}", start_time.elapsed());
    // 4. 返回 runtimePath (虚拟路径)
    Ok(format!("_temp/{}", filename))
}

// 辅助：处理外部文件的导入（读取 -> 哈希 -> 复制到 assets）
fn import_external_file(src_path: &Path, target_dir: &Path) -> Result<String, String> {
    // 1. 读取源文件
    let data = fs::read(src_path).map_err(|e| format!("Read error: {}", e))?;

    // 2. 获取扩展名 (如 jpg, png)
    let ext = src_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("bin"); // 默认 fallback

    // 3. 计算 Hash 文件名 (防止文件名冲突)
    let filename = get_hash_filename(&data, ext);
    let dest_path = target_dir.join(&filename);

    // 4. 写入 assets (如果不存在的话)
    if !dest_path.exists() {
        fs::write(&dest_path, &data).map_err(|e| format!("Write error: {}", e))?;
    }

    Ok(format!("assets/{}", filename))
}

#[tauri::command]
async fn commit_assets(
    app: AppHandle,
    project_root: String,
    runtime_paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let temp_dir = get_temp_dir(&app);
    let target_dir = Path::new(&project_root).join("assets");

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
    }

    let mut new_paths = Vec::new();

    for r_path in runtime_paths {
        // === 情况 A: 临时文件 (_temp/...) ===
        if r_path.starts_with("_temp/") {
            let filename = r_path.strip_prefix("_temp/").unwrap();
            let src_path = temp_dir.join(filename);
            let dest_path = target_dir.join(filename);

            // 移动文件 (Move)
            if src_path.exists() {
                if !dest_path.exists() {
                    // 尝试重命名/移动
                    fs::rename(&src_path, &dest_path)
                        .or_else(|_| {
                            // 跨盘符移动失败时，回退到 复制+删除
                            fs::copy(&src_path, &dest_path).and_then(|_| fs::remove_file(&src_path))
                        })
                        .map_err(|e| e.to_string())?;
                } else {
                    // 目标已存在，直接删除临时文件
                    let _ = fs::remove_file(&src_path);
                }
            }
            new_paths.push(format!("assets/{}", filename));
        }
        // === 情况 B: 外部绝对路径 (C:/... 或 /Users/...) ===
        else {
            let path_obj = Path::new(&r_path);
            if path_obj.is_absolute() && path_obj.exists() {
                // 导入外部文件 (Copy & Hash)
                match import_external_file(path_obj, &target_dir) {
                    Ok(relative_path) => new_paths.push(relative_path),
                    Err(e) => {
                        println!("Failed to import {}: {}", r_path, e);
                        // 如果失败，暂时保留原路径，或者报错
                        new_paths.push(r_path);
                    }
                }
            } else {
                // === 情况 C: 已经是 assets/ 或其他情况 ===
                new_paths.push(r_path);
            }
        }
    }

    Ok(new_paths)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 1. 初始化线程池
        .setup(|app| {
            // 获取 CPU 核心数，设置合理的并发量 (例如核心数 * 2，或者是固定值 4)
            // 图片处理是 CPU 密集型，建议设为 num_cpus::get()
            let workers = num_cpus::get();

            // 创建线程池，并显式增加栈大小以防止 Stack Overflow
            let pool = threadpool::Builder::new()
                .num_threads(workers)
                .thread_stack_size(8 * 1024 * 1024) // 设置为 8MB 栈空间 (默认通常是 2MB)
                .thread_name("thumb-worker".into())
                .build();

            // 将线程池托管给 Tauri
            app.manage(ThumbnailCacheState { pool });
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("thumb", thumb_protocol::protocol_handler)
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_temp_image, commit_assets])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
