/**
 * 加载项目 .env 到 process.env（用 Node 内置 loadEnvFile，无第三方依赖）。
 * 文件不存在则静默跳过。FIGMA_TOKEN 等敏感值走 .env（已 gitignore）。
 */
export function loadEnv(path = '.env'): void {
  const p = process as unknown as { loadEnvFile?: (path?: string) => void };
  try {
    p.loadEnvFile?.(path);
  } catch {
    // 没有 .env 文件，跳过
  }
}
