import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'tests/ui',fullyParallel:false,workers:1,timeout:30000,
  use:{baseURL:'http://127.0.0.1:4173',channel:'chrome',viewport:{width:1366,height:900},trace:'retain-on-failure'},
  webServer:{command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:false,timeout:30000},
  reporter:[['list'],['html',{open:'never'}]],
});
