// The Python side of the parity tests: the Python that OSG_PARITY_PYTHON
// names, given its input and taking its output through files, not pipes. On
// macOS a large input written down spawnSync's pipe stopped moving twice on
// 2026-11-20: node kept polling for the pipe to take more while Python sat in
// read() waiting for the rest, and the test run waited until it was killed.
// A file can't stop like that.
//   OSG_PARITY_PYTHON=/path/to/python node --test osg/tests/*.test.ts

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const python = process.env.OSG_PARITY_PYTHON || 'python3';

export interface PythonRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** `python -I <args>` in `cwd`, with `input` as its stdin in UTF-8, and what it wrote, read as UTF-8. */
export function callPython(args: string[], input: string, cwd: string): PythonRun {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-python-'));
  try {
    const [stdin, stdout, stderr] = ['stdin', 'stdout', 'stderr'].map((name) => path.join(dir, name));
    fs.writeFileSync(stdin, input);
    const fds = [fs.openSync(stdin, 'r'), fs.openSync(stdout, 'w'), fs.openSync(stderr, 'w')];
    let run: ReturnType<typeof spawnSync>;
    try {
      run = spawnSync(python, ['-I', ...args], { cwd, stdio: fds });
    } finally {
      for (const fd of fds) fs.closeSync(fd);
    }
    if (run.error) throw run.error;
    return { status: run.status, stdout: fs.readFileSync(stdout, 'utf8'), stderr: fs.readFileSync(stderr, 'utf8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
