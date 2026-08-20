// 批 3:递归拷贝 src/game-templates/ → build/game-templates/(类比 build 内联的 .gd 拷贝;
// 散文件资产保持原样,GDScript 可被语法校验,npm files 覆盖 build/game-templates/**)。
import { cpSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src', 'game-templates');
const dst = join(here, '..', 'build', 'game-templates');

if (!existsSync(src)) {
  console.error('copy-game-templates: src/game-templates not found');
  process.exit(1);
}
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log('Copied game-templates ->', dst);
