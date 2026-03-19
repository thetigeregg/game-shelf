#!/usr/bin/env node
import { execSync } from 'node:child_process';

const projects = [
  { name: 'root', path: '.' },
  { name: 'server', path: 'server' },
  { name: 'worker', path: 'worker' },
  { name: 'hltb-scraper', path: 'hltb-scraper' },
  { name: 'metacritic-scraper', path: 'metacritic-scraper' },
  { name: 'psprices-scraper', path: 'psprices-scraper' },
];

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

for (const project of projects) {
  console.log(`\n==============================`);
  console.log(`📦 Updating ${project.name}`);
  console.log(`==============================`);

  try {
    run(`npx npm-check-updates -i --packageFile ${project.path}/package.json`);
    run(`npm --prefix ${project.path} install`);
  } catch (err) {
    console.error(`❌ Failed in ${project.name}`);
    process.exit(1); // fail fast
  }
}

console.log('\n✅ All projects updated successfully');
