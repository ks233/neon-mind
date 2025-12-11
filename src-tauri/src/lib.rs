// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use image::ImageFormat;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::thread;
use tauri::{
    http::{header, Response, StatusCode},
    AppHandle, Manager,
};
use threadpool::ThreadPool; // [!code focus]
struct ThumbnailCacheState {
    pool: ThreadPool,
}

use base64::{engine::general_purpose, Engine as _};

// =========================================================
// 1. 辅助函数：路径管理
// =========================================================

// 获取 App 临时目录 (Runtime Path 存放处)
fn get_temp_dir(app: &AppHandle) -> PathBuf {
    app.path().app_cache_dir().unwrap().join("temp_images")
}

// 获取 App 缩略图缓存目录
fn get_thumb_cache_dir(app: &AppHandle) -> PathBuf {
    app.path().app_cache_dir().unwrap().join("thumbs")
}

// 计算内容 Hash 并生成文件名
fn get_hash_filename(data: &[u8], ext: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    format!("{}.{}", hex::encode(result), ext)
}

// =========================================================
// 2. Tauri Commands (供前端调用)
// =========================================================

#[tauri::command]
async fn save_temp_image(app: AppHandle, base64_data: String) -> Result<String, String> {
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

// =========================================================
// 3. 协议升级：统一资源加载逻辑
// =========================================================

fn resolve_real_path(
    app: &AppHandle,
    path_str: &str,
    project_root: Option<String>,
) -> Option<PathBuf> {
    // A. 临时文件: _temp/hash.png
    if path_str.starts_with("_temp/") {
        let filename = path_str.strip_prefix("_temp/").unwrap();
        return Some(get_temp_dir(app).join(filename));
    }

    // B. 相对路径: assets/hash.png (需要 project_root)
    if !Path::new(path_str).is_absolute() {
        if let Some(root) = project_root {
            return Some(Path::new(&root).join(path_str));
        }
    }

    // C. 绝对路径 (旧兼容或拖入文件): C:/...
    let p = PathBuf::from(path_str);
    if p.exists() {
        return Some(p);
    }

    None
}

// === 1. 修改缓存路径生成 ===
// 增加 size 参数，生成不同的缓存文件名
fn get_cache_path(app: &AppHandle, original_path: &str, size: u32) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(original_path.as_bytes());
    // 将尺寸也加入 hash 计算，或者直接拼在文件名里
    let result = hasher.finalize();

    // 文件名格式: hash_500.jpg
    let filename = format!("{}_{}.jpg", hex::encode(result), size);

    let cache_dir = app.path().app_cache_dir().expect("failed to get cache dir");
    let thumb_dir = cache_dir.join("thumbs");
    if !thumb_dir.exists() {
        let _ = fs::create_dir_all(&thumb_dir);
    }
    thumb_dir.join(filename)
}

// === 2. 修改处理逻辑，支持动态尺寸 ===
fn process_thumbnail(
    app: &AppHandle,
    file_path: PathBuf,
    target_width: u32,
) -> Result<(Vec<u8>, String), String> {
    // 1. 确保源文件存在
    if !file_path.exists() {
        return Err(format!("Source file not found: {:?}", file_path));
    }

    // === 新增：处理原图请求 (w=0) ===
    if target_width == 0 {
        // 直接读取原文件
        let buffer = fs::read(&file_path).map_err(|e| e.to_string())?;

        // 根据扩展名推断 Mime Type
        let mime_type = file_path
            .extension()
            .and_then(|s| s.to_str())
            .map(|ext| match ext.to_lowercase().as_str() {
                "png" => "image/png",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "svg" => "image/svg+xml",
                "jpg" | "jpeg" => "image/jpeg",
                _ => "application/octet-stream",
            })
            .unwrap_or("application/octet-stream")
            .to_string();

        return Ok((buffer, mime_type));
    }

    // 2. 生成缓存路径
    // 将 路径 + 目标宽度 组合成 hash，确保不同尺寸有不同缓存
    let path_str = file_path.to_string_lossy();
    let cache_key = format!("{}?w={}", path_str, target_width);

    let mut hasher = Sha256::new();
    hasher.update(cache_key.as_bytes());
    let filename = format!("{}.jpg", hex::encode(hasher.finalize()));

    let thumb_dir = get_thumb_cache_dir(app);
    if !thumb_dir.exists() {
        let _ = fs::create_dir_all(&thumb_dir);
    }
    let cache_path = thumb_dir.join(filename);

    // 3. 命中缓存：直接读取返回
    if cache_path.exists() {
        // 简单的读取文件逻辑
        let mut file = File::open(&cache_path).map_err(|e| e.to_string())?;
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
        return Ok((buffer, "image/jpeg".to_string()));
    }

    // 4. 未命中：生成缩略图 (CPU 密集操作)
    // image::open 支持多种格式自动识别
    let img = image::open(&file_path).map_err(|e| format!("Failed to open image: {}", e))?;

    // 使用 thumbnail 方法保持比例缩放 (target_width x target_width 为最大边界)
    let thumb = img.thumbnail(target_width, target_width);

    let mut buffer = Vec::new();
    let mut cursor = Cursor::new(&mut buffer);
    // 统一转为 JPEG 存储，质量默认
    thumb
        .write_to(&mut cursor, ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;

    // 写入缓存文件
    fs::write(&cache_path, &buffer).map_err(|e| e.to_string())?;
    Ok((buffer, "image/jpeg".to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // [!code focus:20] 1. 初始化线程池
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
        .register_asynchronous_uri_scheme_protocol("thumb", move |ctx, request, responder| {
            // 1. 克隆 AppHandle 以便在线程中使用
            let app = ctx.app_handle().clone();

            // 2. 获取请求 URI
            let uri = request.uri().clone();
            let app_worker = app.clone();
            let state = app_worker.state::<ThumbnailCacheState>();
            // 3. 开启新线程处理 (如果是线程池方案，使用 state.pool.execute)
            state.pool.execute(move || {
                let uri_str = uri.to_string();

                // === A. 解析 URL 参数 ===
                let mut target_width = 500; // 默认 LOD
                let mut project_root: Option<String> = None;

                // 分割 path 和 query
                let parts: Vec<&str> = uri_str.split('?').collect();
                let raw_url_path = parts[0]; // "thumb://localhost/..."

                if parts.len() > 1 {
                    // 解析 query: w=1500&root=D:/Projects/MyMap
                    for pair in parts[1].split('&') {
                        if let Some((k, v)) = pair.split_once('=') {
                            match k {
                                "w" => target_width = v.parse().unwrap_or(500),
                                "root" => {
                                    // root 参数也是 url encoded 的，需要解码
                                    if let Ok(decoded_root) = urlencoding::decode(v) {
                                        project_root = Some(decoded_root.to_string());
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }

                // === B. 解析文件路径 ===
                // 移除协议头
                let path_part = if let Some(p) = raw_url_path.strip_prefix("thumb://localhost/") {
                    p
                } else if let Some(p) = raw_url_path.strip_prefix("thumb://") {
                    p
                } else {
                    raw_url_path
                };

                // URL 解码路径 (例如处理中文文件名或空格)
                let decoded_path_str = urlencoding::decode(path_part)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|_| path_part.to_string());

                // === C. 路由到真实物理路径 ===
                // 调用之前定义的 resolve_real_path
                let real_path_opt = resolve_real_path(&app, &decoded_path_str, project_root);

                // === D. 生成并返回 ===
                let response = match real_path_opt {
                    Some(real_path) => {
                        // [修改] 解构元组 (data, mime_type)
                        match process_thumbnail(&app, real_path, target_width) {
                            Ok((data, mime_type)) => {
                                Response::builder()
                                    .status(StatusCode::OK)
                                    // [修改] 使用动态 MimeType
                                    .header(header::CONTENT_TYPE, mime_type)
                                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                                    .header(header::CACHE_CONTROL, "public, max-age=31536000")
                                    .body(data)
                                    .unwrap()
                            }
                            Err(e) => {
                                eprintln!("Thumb processing error: {}", e);
                                Response::builder()
                                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                                    .body(e.as_bytes().to_vec())
                                    .unwrap()
                            }
                        }
                    }
                    None => {
                        eprintln!("Thumb 404 - Path resolve failed: {}", decoded_path_str);
                        Response::builder()
                            .status(StatusCode::NOT_FOUND)
                            .body("File not found".as_bytes().to_vec())
                            .unwrap()
                    }
                };

                responder.respond(response);
            });
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_temp_image, commit_assets])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
