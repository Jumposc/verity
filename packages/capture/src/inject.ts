/**
 * IIFE 注入入口。tsup 以 --format iife --global-name __verityCapture 打包，
 * 页面注入后通过 globalThis.__verityCapture.captureDom 调用。零运行时依赖（仅类型导入，已擦除）。
 */
export { captureDom, CAPTURE_PROPS } from './capture';
