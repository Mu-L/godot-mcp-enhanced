/** 6 个评分维度 */
export type DimensionName =
  | 'integration'
  | 'coverage'
  | 'security'
  | 'flaky'
  | 'performance'
  | 'gdscript';

export type DimensionStatus = 'pass' | 'warn' | 'fail' | 'na';

/** 单维度标准化结果(采集器产出,评分函数消费) */
export interface DimensionResult {
  /** 0-100;NA_SCORE(-1)表示未采集 */
  score: number;
  /** 该维度权重(0-1),来自 WEIGHTS */
  weight: number;
  status: DimensionStatus;
  /** 原始指标,采集器自行填充 */
  raw?: unknown;
  detail?: string;
}

/** 硬否决记录:某维度低于红线,无视总分直接 fail */
export interface HardFail {
  dimension: DimensionName;
  reason: string;
  threshold: number;
  actual: number;
}

/** check-gdscript 产出 / collectGdscript 消费的共享契约(TS 两侧锁字段) */
export interface GdscriptReport {
  errors: number;
  warnings: number;
  files: number;         // 检查的 .gd 文件数(断言用)
  details: string[];     // 全部问题明细(errors 优先),≤20 条
  detailsTotal: number;  // = errors + warnings(独立计数,不受截断影响)
  incomplete?: boolean;  // check-gdscript 断言失败(setup 坏) → collector score=0
  reason?: string;
}

/** 评分产物——PR gate / dashboard / 发版的单一事实源 */
export interface ScoreJson {
  total: number;          // 0-100,一位小数
  pass: boolean;          // total>=PASS_LINE 且无硬否决
  partial: boolean;       // 存在 n/a 维度
  godotVersion?: string;
  generatedAt: string;    // ISO 时间
  dimensions: Record<DimensionName, DimensionResult>;
  unverified: DimensionName[];   // score===NA_SCORE 的维度
  hardFails: HardFail[];
}
