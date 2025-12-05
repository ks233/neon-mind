<script setup lang="ts">
// 这里不需要 props，因为原点就是单纯的视觉标记
</script>

<template>
  <div class="origin-gizmo">
    <svg width="1" height="13" style="overflow: visible;">
      <line x1="-50000" y1="0" x2="50000" y2="0" stroke="#ff4d4f" stroke-width="2" stroke-opacity="0.3" />
      <line x1="1" y1="-50000" x2="1" y2="50000" stroke="#52c41a" stroke-width="2" stroke-opacity="0.3" />
      
      <!-- <circle cx="0" cy="0" r="4" fill="#1890ff" /> -->
      
      <!-- <text x="5" y="-5" fill="#999" font-size="10" font-family="monospace">(0,0)</text> -->
    </svg>
  </div>
</template>

<style scoped>
.origin-gizmo {
  /* 关键：VueFlow 节点默认原点在左上角 */
  /* 我们用 CSS transform 把它修正到中心，这样 (0,0) 就在十字交叉点 */
  /* pointer-events: none 确保鼠标点上去会穿透，不会误选到原点 */
  pointer-events: none; 
  /* visibility: visible !important; */
}
</style>