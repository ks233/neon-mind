export async function fetchLinkMetadata(url: string) {
  // 在真实 Tauri 应用中，这里应该调用 Rust 后端命令去请求网页并解析 HTML meta
  // 这里我们用模拟数据演示
  
  console.log('Fetching metadata for:', url);
  
  return new Promise<{ title: string; desc?: string; image?: string }>((resolve) => {
    // 模拟网络延迟
    setTimeout(() => {
      const hostname = new URL(url).hostname;
      resolve({
        title: `Page from ${hostname}`,
        desc: `This is a simulated description for ${url}. It represents the content of the website.`,
        // 使用一个随机图片作为封面演示
        image: `https://picsum.photos/seed/${hostname}/300/150` 
      });
    }, 800);
  });
}