import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { Octokit } from 'octokit';

const DIGITALOCEAN_TOKEN = process.env.DO_TOKEN;
const GITHUB_TOKEN = process.env.GH_TOKEN; // GitHub PAT with "repo" scope

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// get github username
const {
  data: { login },
} = await octokit.rest.users.getAuthenticated();

const APP_NAME = `generated-app-${Date.now()}`;
const SOURCE_URL =
  'https://test-pipeline.sfo3.digitaloceanspaces.com/builds/code.zip';
const TMP_DIR = path.resolve(`./tmp-${APP_NAME}`);

function unzipSource(zipPath, dest) {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(dest, true);
}

// Creates a GitHub repo and returns the full repo info
async function createRepo(repoName) {
  const response = await octokit.request('POST /user/repos', {
    name: repoName,
    description: 'Repository created via Octokit',
    private: false,
  });

  return response.data;
}

// Push local directory to GitHub using the contents API
async function pushDirectoryToRepo(localPath, repoName, branch = 'main') {
  const files = [];

  function walkDir(dir) {
    for (const file of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) walkDir(fullPath);
      else files.push(fullPath);
    }
  }

  walkDir(localPath);

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, { encoding: 'base64' });
    const relativePath = path.relative(localPath, filePath).replace(/\\/g, '/');

    await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
      owner: login,
      repo: repoName,
      path: relativePath,
      message: 'my commit message',
      committer: {
        name: 'm0',
        email: 'kevin@m0.ventures',
      },
      content: content,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  }
}

async function deployApp(spec) {}

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  // console.log(login, 'username of github');

  // 1. Download zip
  const zipPath = path.join(TMP_DIR, 'code.zip');
  const res = await fetch(SOURCE_URL);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(zipPath, buf);

  // 2. Extract
  unzipSource(zipPath, TMP_DIR);

  // 3. Create repositories
  const frontendRepo = await createRepo(`${APP_NAME}-frontend`);
  const backendRepo = await createRepo(`${APP_NAME}-backend`);

  // 4. Push extracted directories
  await pushDirectoryToRepo(
    path.join(TMP_DIR, 'frontend'),
    `${APP_NAME}-frontend`
  );
  await pushDirectoryToRepo(
    path.join(TMP_DIR, 'backend'),
    `${APP_NAME}-backend`
  );

  console.log('Repositories created and pushed:');
  console.log(frontendRepo.html_url, backendRepo.html_url);
}

main().catch(console.error);
