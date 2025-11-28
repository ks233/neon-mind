// 类似于 Unity 的 Data Models
export interface NodeData {
  guid: string;
  content: string;
  width?: number;
  height?: number;
  // 未来扩展
  imageUrl?: string; 
  videoUrl?: string;
}

export interface CanvasProject {
  version: string;
  nodes: NodeData[];
  edges: any[];
  viewport: { x: number, y: number, zoom: number };
}