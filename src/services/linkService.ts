import { fetch } from '@tauri-apps/plugin-http'; // 使用 Tauri 的 fetch (绕过 CORS)
import * as cheerio from 'cheerio';

interface LinkMetadata {
  title: string;
  description?: string;
  image?: string;
  url: string;
}

export async function fetchLinkMetadata(targetUrl: string): Promise<LinkMetadata> {
  try {
    // 1. 确保 URL 格式正确
    const urlObj = new URL(targetUrl);
    
    // 2. 发起请求
    // 注意：设置 User-Agent 很重要，有些网站（如 Twitter/GitHub）会拦截没有 UA 的请求
    const response = await fetch(urlObj.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // 3. 获取 HTML 文本
    const html = await response.text();

    // 4. 加载到 Cheerio
    const $ = cheerio.load(html);

    // 5. 提取元数据 (优先 OpenGraph，降级使用标准标签)
    const getMetaContent = (property: string, name?: string) => {
      return $(`meta[property="${property}"]`).attr('content') || 
             (name ? $(`meta[name="${name}"]`).attr('content') : undefined);
    };

    let title = getMetaContent('og:title') || $('title').text() || targetUrl;
    let description = getMetaContent('og:description', 'description');
    let image = getMetaContent('og:image') || getMetaContent('twitter:image');

    // 6. 处理相对路径图片 (如 "/assets/logo.png" -> "https://example.com/assets/logo.png")
    if (image && !image.startsWith('http')) {
      try {
        image = new URL(image, targetUrl).href;
      } catch (e) {
        image = undefined; // 解析失败则丢弃
      }
    }

    return {
      title,
      description,
      image,
      url: targetUrl
    };

  } catch (error) {
    console.error('Failed to fetch link metadata:', error);
    // 失败时返回最基础的信息，不让应用崩溃
    return {
      title: targetUrl,
      url: targetUrl,
      description: 'Unable to preview content.'
    };
  }
}