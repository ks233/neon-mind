// src-tauri/src/utils.rs
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// 获取 App 临时目录 (Runtime Path 存放处)
pub fn get_temp_dir(app: &AppHandle) -> PathBuf {
    app.path().app_cache_dir().unwrap().join("temp_images")
}

// 获取 App 缩略图缓存目录
pub fn get_thumb_cache_dir(app: &AppHandle) -> PathBuf {
    app.path().app_cache_dir().unwrap().join("thumbs")
}

// 计算内容 Hash 并生成文件名
pub fn get_hash_filename(data: &[u8], ext: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    format!("{}.{}", hex::encode(result), ext)
}
