import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, chmod, copyFile } from 'node:fs/promises';
import { authenticate } from '@google-cloud/local-auth';
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export async function runDriveAuth(stateDir: string): Promise<void> {
  const credentials = existsSync(path.join(stateDir, 'credentials.json')) ? path.join(stateDir, 'credentials.json') : 'credentials.json';
  if (!existsSync(credentials)) throw new Error('Missing Google OAuth credentials.json. Place it in the project root or .igdm/credentials.json.');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const client = await authenticate({ scopes: [DRIVE_READONLY_SCOPE], keyfilePath: credentials });
  if ((client as any).credentials) {
    const tokenPath = path.join(stateDir, 'token.json');
    await copyFile((client as any).cachedCredentialPath ?? tokenPath, tokenPath).catch(async () => undefined);
    await chmod(tokenPath, 0o600).catch(() => undefined);
  }
}
