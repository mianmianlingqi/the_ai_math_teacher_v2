import React from 'react';

// 颜色常量（映射到高数符号）
const C = {
  spade:   '#6366f1', // ∫ 靛紫
  heart:   '#ef4444', // ∑ 红
  diamond: '#f97316', // ∂ 橙
  club:    '#10b981', // π 绿
};

type Variant = 'full' | 'corner' | 'scatter';

interface SuitDecorationsProps {
  variant?: Variant;
}

/**
 * 高数符号装饰层 — 替代 CSS 伪元素方案，实现逐符号四色效果。
 * 父元素需要 `relative overflow-hidden`。
 */
export const SuitDecorations: React.FC<SuitDecorationsProps> = ({ variant = 'corner' }) => {
  if (variant === 'full') {
    // 大面板：12 个符号铺满整个卡片四周边缘，不堆在中央
    return (
      <div className="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
        {/* 顶部 */}
        <span className="absolute top-[3%]  left-[6%]   text-xl  suit-float-2" style={{color:C.spade,   opacity:0.12}}>∫</span>
        <span className="absolute top-[4%]  left-[40%]  text-lg  suit-float-4" style={{color:C.heart,   opacity:0.11}}>∑</span>
        <span className="absolute top-[3%]  right-[8%]  text-sm  suit-float-1" style={{color:C.diamond, opacity:0.11}}>∂</span>
        {/* 左侧 */}
        <span className="absolute top-[28%] left-[2%]   text-lg  suit-float-3" style={{color:C.heart,   opacity:0.11}}>∑</span>
        <span className="absolute top-[58%] left-[3%]   text-sm  suit-float-1" style={{color:C.club,    opacity:0.10}}>π</span>
        {/* 右侧 */}
        <span className="absolute top-[22%] right-[2%]  text-xl  suit-float-2" style={{color:C.club,    opacity:0.11}}>π</span>
        <span className="absolute top-[55%] right-[2%]  text-lg  suit-float-4" style={{color:C.spade,   opacity:0.10}}>∫</span>
        {/* 底部 */}
        <span className="absolute bottom-[4%] left-[8%]  text-lg  suit-float-4" style={{color:C.diamond, opacity:0.12}}>∂</span>
        <span className="absolute bottom-[3%] left-[38%] text-xl  suit-float-2" style={{color:C.spade,   opacity:0.12}}>∫</span>
        <span className="absolute bottom-[5%] right-[14%] text-lg suit-float-3" style={{color:C.heart,   opacity:0.12}}>∑</span>
        <span className="absolute bottom-[12%] right-[6%] text-sm suit-float-1" style={{color:C.diamond, opacity:0.11}}>∂</span>
        <span className="absolute bottom-[8%] right-[4%] text-xl suit-float-2" style={{color:C.club,    opacity:0.12}}>π</span>
      </div>
    );
  }

  if (variant === 'scatter') {
    // 中等容器：4 个符号聚集在右下角，留出右侧按钮空间
    return (
      <div className="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
        <span className="absolute bottom-[8%]  right-[12%] text-3xl suit-float-1" style={{color:C.spade,   opacity:0.14}}>∫</span>
        <span className="absolute bottom-[16%] right-[16%] text-2xl suit-float-3" style={{color:C.heart,   opacity:0.14}}>∑</span>
        <span className="absolute bottom-[6%]  right-[21%] text-xl  suit-float-2" style={{color:C.diamond, opacity:0.13}}>∂</span>
        <span className="absolute bottom-[20%] right-[10%] text-lg  suit-float-4" style={{color:C.club,    opacity:0.13}}>π</span>
      </div>
    );
  }

  // corner — 默认，只在右下角点缀
  return (
    <div className="absolute inset-0 pointer-events-none select-none" aria-hidden="true">
      <span className="absolute bottom-2  right-3  text-xl  suit-float-1" style={{color:C.spade,   opacity:0.18}}>∫</span>
      <span className="absolute bottom-5  right-8  text-lg  suit-float-3" style={{color:C.heart,   opacity:0.17}}>∑</span>
      <span className="absolute bottom-2  right-12 text-sm  suit-float-2" style={{color:C.diamond, opacity:0.15}}>∂</span>
      <span className="absolute bottom-7  right-4  text-sm  suit-float-4" style={{color:C.club,    opacity:0.15}}>π</span>
    </div>
  );
};
