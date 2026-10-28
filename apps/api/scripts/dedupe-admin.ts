/**
 * 按 user_id 去重 app_user / app_user_access（保留最新一行）
 * 用法：cd apps/api && npx tsx scripts/dedupe-admin.ts
 */
import { BigQuery } from '@google-cloud/bigquery';
import { env } from '../src/config.js';
import {
  findUserByUsername,
  invalidateAccessCache,
  verifyPassword,
} from '../src/access/store.js';

async function main() {
  const project = env.gcpProjectId;
  const bq = new BigQuery({ projectId: project });
  console.log(`dedupe in ${project}.review_control (dryRun=${env.importDryRun})`);

  await bq.query({
    query: `
      CREATE OR REPLACE TABLE \`${project}.review_control.app_user\` AS
      SELECT * EXCEPT(_rn) FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY user_id
            ORDER BY updated_at DESC, created_at DESC
          ) AS _rn
        FROM \`${project}.review_control.app_user\`
      )
      WHERE _rn = 1
    `,
  });
  await bq.query({
    query: `
      CREATE OR REPLACE TABLE \`${project}.review_control.app_user_access\` AS
      SELECT * EXCEPT(_rn) FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY user_id
            ORDER BY policy_version DESC, valid_from DESC, updated_at DESC
          ) AS _rn
        FROM \`${project}.review_control.app_user_access\`
      )
      WHERE _rn = 1
    `,
  });

  const [[users], [access]] = await Promise.all([
    bq.query({
      query: `
        SELECT user_id, username, LEFT(password_hash, 22) AS hash_prefix, status
        FROM \`${project}.review_control.app_user\`
      `,
    }),
    bq.query({
      query: `
        SELECT access_id, user_id, brand_keys, page_keys
        FROM \`${project}.review_control.app_user_access\`
      `,
    }),
  ]);

  console.log('app_user:', users);
  console.log('app_user_access:', access);

  invalidateAccessCache('admin');
  const found = await findUserByUsername('admin');
  const passwordOk = found
    ? await verifyPassword('19970222', found.user.passwordHash)
    : false;
  console.log({ found: Boolean(found), passwordOk });
  if (!found || !passwordOk) process.exit(1);
  console.info('去重完成，admin / 19970222 可用');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
