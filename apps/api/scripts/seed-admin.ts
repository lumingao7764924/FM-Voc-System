/**
 * 写真库初始化超级管理员：admin / 19970222
 * 用法：cd apps/api && npx tsx scripts/seed-admin.ts
 */
import { ensureSeedAdmin, findUserByUsername, verifyPassword, invalidateAccessCache } from '../src/access/store.js';
import { env } from '../src/config.js';

async function main() {
  console.log(`dryRun=${env.importDryRun} project=${env.gcpProjectId}`);
  if (env.importDryRun) {
    console.warn('IMPORT_DRY_RUN=true：只会写内存，不会写 BigQuery');
  }

  invalidateAccessCache('admin');
  await ensureSeedAdmin();
  invalidateAccessCache('admin');

  const found = await findUserByUsername('admin');
  if (!found) {
    console.error('seed 后仍找不到 admin，请检查 BQ 表 review_control.app_user / app_user_access');
    process.exit(1);
  }

  const passwordOk = await verifyPassword('19970222', found.user.passwordHash);
  console.log(
    JSON.stringify(
      {
        userId: found.user.userId,
        username: found.user.username,
        status: found.user.status,
        isBootstrapAdmin: found.user.isBootstrapAdmin,
        passwordOk,
        pageKeys: found.access.pageKeys,
        brandKeys: found.access.brandKeys,
        manageUsers: found.access.flags.manageUsers,
      },
      null,
      2,
    ),
  );

  if (!passwordOk) {
    console.error('密码校验失败');
    process.exit(1);
  }
  console.info('超级管理员已就绪：admin / 19970222');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
