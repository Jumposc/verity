// 统一数据契约
export * from './schema';

// 确定性内核：颜色 / 几何原语 / 多信号配对 / 纯客观 diff / 基线指标 / 报告
export * from './color';
export * from './geom';
export * from './match/geometry';
export * from './match/fold';
export * from './diff/attributes';
export * from './diff/geometry';
export * from './compute';
export * from './report/html';

// 两端 adapter 接缝：契约类型已定，映射体待数据层补齐
export * from './adapters/figma';
export * from './adapters/dom';
