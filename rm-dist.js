import fg from 'fast-glob';
import { rm } from 'node:fs/promises';

fg(['dist', 'packages/*/dist'], { onlyDirectories: true }).then(dirs =>
  Promise.all(dirs.map(dir => rm(dir, { force: true, recursive: true })))
);

fg(['**/tsconfig.tsbuildinfo'], { onlyFiles: true }).then(files =>
  Promise.all(files.map(file => rm(file, { force: true })))
);
