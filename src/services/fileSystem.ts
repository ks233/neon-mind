// 定义接口，方便以后替换实现 (Web vs Desktop)
interface IFileSystem {
  saveFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
}

// Tauri 实现
export const tauriFileSystem: IFileSystem = {
  async saveFile(path, content) {
    // 动态导入，防止 Web 环境报错
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
  },
  async readFile(path) {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return await readTextFile(path);
  }
};