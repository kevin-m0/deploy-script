import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { Octokit } from 'octokit';

// const DIGITALOCEAN_TOKEN = process.env.DO_TOKEN;
const KOYEB_API_BASE_URL = 'https://app.koyeb.com/';
const KOYEB_API_TOKEN = process.env.KOYEB_API_TOKEN;
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

// add error handling as it is given in koyeb api reference
async function deployApp(repoName) {
  console.log('inside deploy');

  const repoUrl = `github.com/kevin-m0/${repoName}`;
  const createApp = await fetch(`${KOYEB_API_BASE_URL}v1/apps`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KOYEB_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: APP_NAME }),
  });

  const appData = await createApp.json();

  const appId = await appData.app.id;

  // sample app created
  //  0a5a847c-eb61-4fa4-bfea-6f80df195485

  const serviceResponse = await fetch(`${KOYEB_API_BASE_URL}v1/services`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KOYEB_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app_id: appId,
      definition: {
        name: 'primary',
        type: 'WEB',
        strategy: {
          type: 'DEPLOYMENT_STRATEGY_TYPE_ROLLING',
        },
        ports: [
          {
            port: '3000',
            protocol: 'http',
          },
        ],
        routes: [
          {
            port: '3000',
            path: '/',
          },
        ],
        regions: ['was'],
        instance_types: [
          {
            scopes: ['region:was'],
            type: 'free',
          },
        ],
        scalings: [
          {
            scopes: ['region:was'],
            min: 0,
            max: 1,
          },
        ],
        skip_cache: true,
        git: {
          repository: repoUrl,
          branch: 'main',
          // sha: '',
          no_deploy_on_push: true,
          workdir: '/',
          buildpack: {
            build_command: 'npm run build',
            run_command: 'npm run start',
            privileged: true,
          },
        },
      },
    }),
  });

  const serviceData = await serviceResponse.json();

  console.log(serviceData, 'serviceData');

  // example service id is 3ea4794b-4eda-4831-a4eb-862b49ff7a00

  const deploymentResponse = await fetch(
    `${KOYEB_API_BASE_URL}v1/deployments/{id}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KOYEB_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: serviceData.service.active_deployment_id }),
    }
  );

  const deploymentData = await deploymentResponse.json();

  console.log(deploymentData, 'deployment data');

  if (deploymentData.deployment.status === 'HEALTHY')
    return `https://${appData.apps.name}/koyeb.app`;
  else return deploymentData.deployment.status;
}

// https://generated-app-1757887270850-metaverseventures-3658cb27.koyeb.app/

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });

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

  console.log(frontendRepo.html_url, backendRepo.html_url);

  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  const link = await deployApp(`${APP_NAME}-frontend`);
  // const link2 = await deployApp(`${APP_NAME}-backend`);
  console.log(String(link));
  // console.log(String(link2));
}

main().catch(console.error);
