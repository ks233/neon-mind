// src-tauri/src/thumb_protocol.rs
use crate::utils::{get_temp_dir, get_thumb_cache_dir};
use fast_image_resize::images::Image;
use fast_image_resize::{IntoImageView, ResizeAlg, ResizeOptions, Resizer};
use image::ImageReader;
use sha2::{Digest, Sha256};
use std::fs::{self};
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use tauri::Wry;
use tauri::{
    http::{header, Request, Response, StatusCode},
    AppHandle, Manager,
};
use threadpool::ThreadPool;

use image::codecs::png::PngEncoder;
use image::ImageEncoder;

use std::time::Instant; // 引入计时器

// 定义状态结构体 (需要在 lib.rs 中 pub 以便 manage)
pub struct ThumbnailCacheState {
    pub pool: ThreadPool,
}

// 获取文件 MIME Type
fn get_mime_type(path: &Path) -> String {
    mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string()
}

// 核心：处理图片
fn process_thumbnail(
    app: &AppHandle,
    file_path: PathBuf,
    target_width: u32,
) -> Result<(Vec<u8>, String), String> {
    if !file_path.exists() {
        return Err(format!("Source file not found: {:?}", file_path));
    }

    let start_time = Instant::now(); // 计时
    let path_str = file_path.to_string_lossy();
    let (orig_width, orig_height) = image::image_dimensions(&file_path)
        .map_err(|_err| format!("无法获取图片宽度: {}", path_str))?;
    // A. 原图请求
    if target_width == 0 || orig_width < target_width {
        let buffer = fs::read(&file_path).map_err(|e| e.to_string())?;
        let mime_type = get_mime_type(&file_path);
        // println!("Original：{}", path_str);
        return Ok((buffer, mime_type));
    }

    // B. 缩略图请求
    let cache_key = format!("{}?w={}", path_str, target_width);
    let mut hasher = Sha256::new();
    hasher.update(cache_key.as_bytes());
    let filename = format!("{}_{}.png", hex::encode(hasher.finalize()), target_width);

    let thumb_dir = get_thumb_cache_dir(app);
    if !thumb_dir.exists() {
        let _ = fs::create_dir_all(&thumb_dir);
    }
    let cache_path = thumb_dir.join(filename);

    if cache_path.exists() {
        let buffer = fs::read(&cache_path).map_err(|e| e.to_string())?;
        // println!("Cache Hit：{}", cache_path.to_string_lossy());
        return Ok((buffer, "image/png".to_string()));
    }

    let open_start = Instant::now();
    // 生成
    let src_image = ImageReader::open(&file_path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .decode()
        .unwrap();

    let target_height = (orig_height as f64 * target_width as f64 / orig_width as f64) as u32;
    let mut dst_image = Image::new(target_width, target_height, src_image.pixel_type().unwrap());

    let open_time = open_start.elapsed();

    let resize_start = Instant::now();
    let mut resizer = Resizer::new();
    resizer
        .resize(
            &src_image,
            &mut dst_image,
            &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(
                fast_image_resize::FilterType::Lanczos3,
            )),
        )
        .map_err(|e| e.to_string())?;

    let resize_time = resize_start.elapsed();

    let encode_start = Instant::now();
    // let file = File::create(cache_path);
    let mut result_buf = BufWriter::new(Vec::new());
    PngEncoder::new(&mut result_buf)
        .write_image(
            dst_image.buffer(),
            target_width,
            target_height,
            src_image.color().into(),
        )
        .unwrap();

    let encode_time = encode_start.elapsed();
    let buffer = result_buf.into_inner().unwrap();

    fs::write(&cache_path, buffer.clone()).map_err(|e| e.to_string())?;
    println!(
        "{}->{}，总耗时：{:?}，打开：{:?}，缩放：{:?}，编码：{:?}",
        orig_width,
        target_width,
        start_time.elapsed(),
        open_time,
        resize_time,
        encode_time
    );
    Ok((buffer, "image/png".to_string()))
}

// 路径路由
fn resolve_real_path(
    app: &AppHandle,
    path_str: &str,
    project_root: Option<String>,
) -> Option<PathBuf> {
    if path_str.starts_with("_temp/") {
        let filename = path_str.strip_prefix("_temp/").unwrap();
        return Some(get_temp_dir(app).join(filename));
    }
    if !Path::new(path_str).is_absolute() {
        if let Some(root) = project_root {
            return Some(Path::new(&root).join(path_str));
        }
    }
    let p = PathBuf::from(path_str);
    if p.exists() {
        return Some(p);
    }
    None
}

// 暴露给 lib.rs 的协议处理函数
pub fn protocol_handler(
    ctx: tauri::UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let app_worker = app.clone();
    let state = app.state::<ThumbnailCacheState>();
    let uri = request.uri().clone();

    state.pool.execute(move || {
        let uri_str = uri.to_string();
        let mut target_width = 0;
        let mut project_root: Option<String> = None;

        let parts: Vec<&str> = uri_str.split('?').collect();
        let raw_url_path = parts[0];

        if parts.len() > 1 {
            for pair in parts[1].split('&') {
                if let Some((k, v)) = pair.split_once('=') {
                    match k {
                        "w" => target_width = v.parse().unwrap_or(0),
                        "root" => {
                            if let Ok(decoded_root) = urlencoding::decode(v) {
                                project_root = Some(decoded_root.to_string());
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        let path_part = if let Some(p) = raw_url_path.strip_prefix("thumb://localhost/") {
            p
        } else if let Some(p) = raw_url_path.strip_prefix("thumb://") {
            p
        } else {
            raw_url_path
        };

        let decoded_path_str = urlencoding::decode(path_part)
            .map(|s| s.to_string())
            .unwrap_or_else(|_| path_part.to_string());

        let real_path_opt = resolve_real_path(&app_worker, &decoded_path_str, project_root);

        match real_path_opt {
            Some(real_path) => match process_thumbnail(&app_worker, real_path, target_width) {
                Ok((data, mime_type)) => responder.respond(
                    Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, mime_type)
                        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .header(header::CACHE_CONTROL, "public, max-age=31536000")
                        .body(data)
                        .unwrap(),
                ),
                Err(e) => {
                    eprintln!("Thumb Error: {}", e);
                    responder.respond(
                        Response::builder()
                            .status(StatusCode::INTERNAL_SERVER_ERROR)
                            .body(e.into_bytes())
                            .unwrap(),
                    )
                }
            },
            None => responder.respond(
                Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body("File not found".as_bytes().to_vec())
                    .unwrap(),
            ),
        }
    });
}
