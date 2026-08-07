/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: 'node',
  transform: {
    // esModuleInterop is off in tsconfig (esbuild handles the real build), but
    // CommonJS test output needs it for `import React from 'react'` to resolve.
    '^.+.tsx?$': ['ts-jest', { tsconfig: { esModuleInterop: true } }],
  },
}
